import * as React from 'react';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useAllMachines, useMachineListByServerId } from '@/sync/domains/state/storage';
import { machineSharedFoldersList } from '@/sync/ops/machines';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';

export type FolderSharedToMachine = Readonly<{
    /** Where it is mounted on that machine, as a `~/…` path there: `~/local/mac/code`. */
    path: string;
    /** The computer it belongs to, and the folder there (relative to that computer's home). */
    computerName: string;
    folder: string;
}>;

const NONE: readonly FolderSharedToMachine[] = [];

/**
 * The folders the account's other computers share with `machineId` and that are mounted there now,
 * from each computer's own list (`DAEMON_FOLDER_SHARE_LIST`: the computer owns its shares). The
 * computers are those of the relay the picker targets (`serverId`; the active relay when omitted).
 * Asked when the surface that offers them mounts — an open picker — and again only when that set of
 * online computers changes. Each computer's folders appear as soon as it answers, in the machine
 * list's order; an offline computer, or one whose PiggerCode predates shared folders, adds none.
 */
export function useFoldersSharedToMachine(machineId: string | null, serverId: string | null): readonly FolderSharedToMachine[] {
    const activeServerId = useActiveServerSnapshot().serverId;
    const activeMachines = useAllMachines();
    const machineListByServerId = useMachineListByServerId();
    const machines = !serverId || serverId === activeServerId ? activeMachines : machineListByServerId[serverId] ?? [];
    const computersKey = React.useMemo(
        () => JSON.stringify(machines
            .filter((machine) => machine.id !== machineId && isMachineOnline(machine))
            .map((machine) => [machine.id, getMachineDisplayName(machine) ?? machine.id])),
        [machineId, machines],
    );
    const [folders, setFolders] = React.useState<readonly FolderSharedToMachine[]>(NONE);
    React.useEffect(() => {
        setFolders(NONE);
        const computers = JSON.parse(computersKey) as Array<[string, string]>;
        if (!machineId || computers.length === 0) return;
        let cancelled = false;
        const answered = new Map<string, readonly FolderSharedToMachine[]>();
        for (const [computerId, computerName] of computers) {
            void machineSharedFoldersList(computerId, { serverId }).catch(() => null).then((state) => {
                if (cancelled || state?.status !== 'ok') return;
                const shared = state.shares
                    .filter((share) => share.serverMachineId === machineId && share.state === 'connected')
                    .map((share) => ({ path: share.serverPath, computerName, folder: share.folder }));
                // Nothing shared keeps the one empty value, so the picker does not render again for it.
                if (shared.length === 0) return;
                answered.set(computerId, shared);
                setFolders(computers.flatMap(([id]) => answered.get(id) ?? []));
            });
        }
        return () => {
            cancelled = true;
        };
    }, [computersKey, machineId, serverId]);
    return folders;
}
