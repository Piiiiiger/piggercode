import * as React from 'react';

import { useCliUpdateTask } from '@/components/settings/machines/localControl/useCliUpdateTask';
import { buildLocalDaemonServiceSystemTaskSpec } from '@/components/settings/machines/localControl/buildLocalDaemonServiceSystemTaskSpec';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { readKeptCliUpdateCommand, type DesktopLocalInspection, type DesktopLocalReadinessFacts } from '@/setup/deriveDesktopLocalSetupSnapshot';
import { desktopSetupCoordinator, resolveThisComputerServiceForActiveRelay } from '@/setup/desktopSetupCoordinator';
import { useActiveServerAccountScope } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { isTauriDesktop } from '@/utils/platform/tauri';

import { buildThisComputerCliUpdateItem } from './items/buildMachineUpdateItems';
import type { UpdateItem } from './items/updateItem';

export type ThisComputerCliUpdate = Readonly<{
    /** `null` off the desktop app, and until this computer's inspection has answered. */
    item: UpdateItem | null;
    machineId: string | null;
    run: () => Promise<void>;
    /** `run` would start the update now (the desktop app, a row, and the account it acts for). */
    canRun: boolean;
}>;

const NOOP = async () => {};

/**
 * What this computer's local inspection says about its one PiggerCode CLI. The machine is the one
 * that answers for the app's relay — its own pinned service's when it has one here — so this
 * computer's row replaces that machine's row in the relay's machine list. The CLI facts are this
 * computer's one CLI's whichever service reports them, so they stay known even when the app relay's
 * own service could not be read; only the machine is then unknown. `null` until an inspection answered.
 */
export function readThisComputerCliFacts(inspection: DesktopLocalInspection): Readonly<{
    facts: DesktopLocalReadinessFacts;
    machineId: string | null;
    currentVersion: string | null;
    latestVersion: string | null;
}> | null {
    const serving = resolveThisComputerServiceForActiveRelay(inspection);
    const facts = serving?.facts ?? (inspection.status === 'resolved' ? inspection.facts : null);
    if (!facts) return null;
    return {
        facts,
        machineId: serving?.facts.auth.machineId ?? null,
        currentVersion: facts.acquisition.version ?? facts.cliUpdate?.currentVersion ?? null,
        latestVersion: facts.cliUpdate?.latestVersion ?? null,
    };
}

/**
 * This computer's Happier CLI row, from the one ambient inspection (never a read of its own) and
 * the one shared CLI-update action (S-10). Cheap: it subscribes to state other surfaces already
 * hold, so the always-mounted summary may use it.
 */
export function useThisComputerCliUpdate(): ThisComputerCliUpdate {
    const desktop = React.useMemo(() => isTauriDesktop(), []);
    const inspection = React.useSyncExternalStore(
        desktopSetupCoordinator.subscribe,
        desktopSetupCoordinator.readInspectionSnapshot,
        desktopSetupCoordinator.readInspectionSnapshot,
    );
    const serverId = useActiveServerSnapshot().serverId;
    const activeScope = useActiveServerAccountScope();
    const task = useCliUpdateTask();
    const local = desktop ? readThisComputerCliFacts(inspection) : null;
    const facts = local?.facts ?? null;
    const machineId = local?.machineId ?? null;
    const cliUpdate = facts?.cliUpdate ?? null;
    const provenance = facts?.acquisition.provenance ?? null;
    const currentVersion = local?.currentVersion ?? null;
    const keptCliUpdateCommand = facts ? readKeptCliUpdateCommand(facts) : null;

    const item = React.useMemo(() => {
        if (!facts) return null;
        return buildThisComputerCliUpdateItem({
            machineId: machineId ?? 'this-computer',
            title: t('updates.happierCliTitle'),
            facts: {
                currentVersion,
                latestVersion: cliUpdate?.latestVersion ?? null,
                managed: provenance === 'managed' && cliUpdate?.managed !== false,
                updateCommand: keptCliUpdateCommand,
            },
            task: { running: task.running, step: task.running ? 'installing' : null, errorMessage: task.errorMessage },
        });
    }, [cliUpdate?.latestVersion, cliUpdate?.managed, currentVersion, facts, keptCliUpdateCommand, machineId, provenance, task.errorMessage, task.running]);

    const startContext = React.useMemo(() => activeScope?.serverId === serverId ? {
        scope: activeScope,
        spec: buildLocalDaemonServiceSystemTaskSpec('cli.update.v1'),
        machineId,
    } : null, [activeScope, machineId, serverId]);
    const run = React.useCallback(async () => {
        if (!desktop || !item || !startContext) return;
        await task.start(startContext);
    }, [desktop, item, startContext, task.start]);
    const canRun = desktop && item !== null && startContext !== null;
    return React.useMemo(() => ({ item, machineId, run: desktop ? run : NOOP, canRun }), [canRun, desktop, item, machineId, run]);
}
