import * as React from 'react';

import { ensureMachineUpdateFactsBackground } from '@/capabilities/ensureAgentInstallablesBackground';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { desktopSetupCoordinator } from '@/setup/desktopSetupCoordinator';
import { useAllMachines } from '@/sync/domains/state/storage';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

import { readThisComputerCliFacts } from './useThisComputerCliUpdate';

/**
 * Keeps the Updates summary's coverage: asks each online machine for its tools' update facts
 * through the installables background owner, whenever the server or its set of online machines changes. The
 * owner's freshness policy decides whether anything is actually sent; no timer re-asks. Renders
 * nothing; the summary only observes the cache this fills.
 */
export function UpdateFactsBackgroundRuntime(props: Readonly<{ enabled: boolean }>): null {
    const machines = useAllMachines();
    // These machines' server: the facts land in that server's cache entries, the ones the summary reads.
    const serverId = useActiveServerSnapshot().serverId;
    const onlineKey = React.useMemo(
        () => machines.filter((machine) => isMachineOnline(machine)).map((machine) => machine.id).sort().join('\u0000'),
        [machines],
    );
    React.useEffect(() => {
        if (!props.enabled || !onlineKey) return;
        void ensureMachineUpdateFactsBackground({ serverId, machineIds: onlineKey.split('\u0000') });
    }, [onlineKey, props.enabled, serverId]);

    const desktop = React.useMemo(() => isTauriDesktop(), []);
    const inspection = React.useSyncExternalStore(
        desktopSetupCoordinator.subscribe,
        desktopSetupCoordinator.readInspectionSnapshot,
        desktopSetupCoordinator.readInspectionSnapshot,
    );
    const local = desktop ? readThisComputerCliFacts(inspection) : null;
    const reread = React.useCallback(() => {
        void desktopSetupCoordinator.inspect({ fresh: true });
    }, []);
    useRereadThisComputerWhenItsDaemonDisagrees({
        enabled: props.enabled && desktop,
        machineId: local?.machineId ?? null,
        inspected: local ? { currentVersion: local.currentVersion, latestVersion: local.latestVersion } : null,
        machines,
        reread,
    });
    return null;
}

type CliVersions = Readonly<{ currentVersion: string | null; latestVersion: string | null }>;

/**
 * This computer's Happier CLI row is read from the desktop's local inspection, not from the facts
 * its daemon publishes (K5). Whenever the two disagree on the versions — the daemon's version check
 * found a newer release after the inspection was read, an update changed the running CLI — the
 * inspection is read again, so the row follows without reopening the app. Once per disagreement: a
 * re-read that leaves the same disagreement is not repeated until either side changes.
 */
export function useRereadThisComputerWhenItsDaemonDisagrees(params: Readonly<{
    enabled: boolean;
    machineId: string | null;
    inspected: CliVersions | null;
    machines: readonly Machine[];
    reread: () => void;
}>): void {
    const { enabled, machineId, inspected, machines, reread } = params;
    const published = machineId ? machines.find((machine) => machine.id === machineId)?.metadata?.cliUpdate : undefined;
    const publishedKey = published ? versionsKey(published) : null;
    const inspectedKey = inspected ? versionsKey(inspected) : null;
    const asked = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!enabled || !machineId || publishedKey === null || inspectedKey === null || publishedKey === inspectedKey) return;
        const disagreement = `${machineId}\u0000${publishedKey}\u0000${inspectedKey}`;
        if (asked.current === disagreement) return;
        asked.current = disagreement;
        reread();
    }, [enabled, inspectedKey, machineId, publishedKey, reread]);
}

function versionsKey(versions: CliVersions): string {
    return `${versions.currentVersion ?? ''}\u0000${versions.latestVersion ?? ''}`;
}
