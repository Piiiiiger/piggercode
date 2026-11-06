import * as React from 'react';

import { checkThisComputerCliNow } from '@/components/settings/machines/localControl/checkThisComputerCli';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useAllMachines } from '@/sync/domains/state/storage';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

import { refreshMachineUpdateFacts } from './machineUpdateRuns';

/**
 * "Check for updates", wherever it is offered (Settings › About, the Updates surface): this app
 * looks for a newer version of itself now, and every online machine re-reads its update facts with
 * its caches bypassed — its agent CLIs' latest versions, and its own CLI's version check, whose
 * answer the machine then republishes. On the desktop app this computer's command line is checked
 * by the app itself too (`checkThisComputerCliNow`), whatever version it runs. `checkApp` is the
 * app update owner's check (`useAppUpdateStatus().checkNow`).
 */
export function useCheckForUpdatesNow(checkApp: () => Promise<void>): () => Promise<void> {
    const machines = useAllMachines();
    const serverId = useActiveServerSnapshot().serverId;
    const desktop = React.useMemo(() => isTauriDesktop(), []);
    const onlineKey = React.useMemo(
        () => machines.filter((machine) => isMachineOnline(machine)).map((machine) => machine.id).join('\u0000'),
        [machines],
    );
    return React.useCallback(async () => {
        for (const machineId of onlineKey ? onlineKey.split('\u0000') : []) refreshMachineUpdateFacts(serverId, machineId);
        if (desktop) void checkThisComputerCliNow();
        await checkApp();
    }, [checkApp, desktop, onlineKey, serverId]);
}
