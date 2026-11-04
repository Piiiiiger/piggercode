import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';
import type { FolderShare } from '@piggercode/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { openMachinePathBrowserModal } from '@/components/ui/pathBrowser/openMachinePathBrowserModal';
import { Modal } from '@/modal';
import { MACHINE_RPC_POLL_INTERVAL_MS } from '@/sync/ops/machineRpcPollInterval';
import {
    machineSharedFolderAdd,
    machineSharedFolderRemove,
    machineSharedFoldersList,
    type MachineSharedFolderChange,
    type MachineSharedFoldersState,
} from '@/sync/ops/machines';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';

/** Another machine of the account that this one can share folders with. */
export type SharedFoldersTarget = Readonly<{ id: string; name: string }>;

export type MachineSharedFoldersGroupProps = Readonly<{
    machineId: string;
    isOnline: boolean;
    serverId?: string | null;
    /** This machine's home, to show a chosen folder as `~/…`. */
    homeDir?: string | null;
    /** The account's other machines. */
    targets: readonly SharedFoldersTarget[];
}>;

/**
 * The folders this machine shares with other machines of the account (shared folders): agents there
 * work on a shared folder's files, which stay on this machine. The machine itself owns its shares and
 * their connections, so they are read and changed through it while it is online. Sharing a folder asks
 * first, saying exactly what the other machine gets.
 */
export function MachineSharedFoldersGroup(props: MachineSharedFoldersGroupProps) {
    const { machineId, isOnline, serverId, homeDir, targets } = props;
    const isFocused = useIsFocused();
    const [state, setState] = React.useState<MachineSharedFoldersState | null>(null);
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        setState(null);
        if (!isOnline) return;
        let cancelled = false;
        void machineSharedFoldersList(machineId, { serverId }).then((next) => {
            if (!cancelled) setState(next);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, isOnline, serverId]);

    // A share that is connecting or reconnecting changes on the machine's side only; ask again while it
    // settles and this screen is in view.
    const settling = state?.status === 'ok' && state.shares.some((share) => share.state !== 'connected');
    React.useEffect(() => {
        if (!settling || !isOnline || !isFocused) return;
        let cancelled = false;
        const timer = setInterval(() => {
            void machineSharedFoldersList(machineId, { serverId }).then((next) => {
                if (cancelled || next.status !== 'ok') return;
                setState((previous) => (sameSharesState(previous, next) ? previous : next));
            });
        }, MACHINE_RPC_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [settling, isOnline, isFocused, machineId, serverId]);

    const machineName = React.useCallback(
        (id: string) => targets.find((target) => target.id === id)?.name ?? t('machine.sharedFolders.unknownMachine'),
        [targets],
    );

    const applyChange = React.useCallback((result: MachineSharedFolderChange, failedTitle: string) => {
        if (result.status === 'ok') {
            setState((previous) => ({
                status: 'ok',
                shares: result.shares,
                ...(previous?.status === 'ok' && previous.unsupported ? { unsupported: previous.unsupported } : {}),
            }));
            return;
        }
        Modal.alert(
            failedTitle,
            result.status === 'refused'
                ? result.message
                : result.status === 'unavailable'
                    ? t('machine.sharedFolders.unavailable')
                    : result.message ?? t('errors.unknownError'),
        );
    }, []);

    const chooseTarget = React.useCallback(async (): Promise<SharedFoldersTarget | null> => {
        if (targets.length === 1) return targets[0]!;
        return await new Promise((resolve) => {
            Modal.alert(t('machine.sharedFolders.chooseMachineTitle'), t('machine.sharedFolders.chooseMachineBody'), [
                ...targets.map((target) => ({ text: target.name, onPress: () => resolve(target) })),
                { text: t('common.cancel'), style: 'cancel' as const, onPress: () => resolve(null) },
            ]);
        });
    }, [targets]);

    const onAdd = React.useCallback(async () => {
        const target = await chooseTarget();
        if (!target) return;
        const folder = await openMachinePathBrowserModal({
            machineId,
            serverId,
            title: t('machine.sharedFolders.pickFolderTitle'),
            initialPath: homeDir ?? null,
        });
        if (!folder) return;
        const shown = formatPathRelativeToHome(folder, homeDir ?? undefined);
        const confirmed = await Modal.confirm(
            t('machine.sharedFolders.confirmTitle', { folder: shown, machine: target.name }),
            t('machine.sharedFolders.confirmBody', { folder: shown, machine: target.name }),
            { confirmText: t('machine.sharedFolders.confirmAction') },
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            applyChange(
                await machineSharedFolderAdd(machineId, { folder, serverMachineId: target.id }, { serverId }),
                t('machine.sharedFolders.addFailedTitle'),
            );
        } finally {
            setBusy(false);
        }
    }, [applyChange, chooseTarget, homeDir, machineId, serverId]);

    const onStop = React.useCallback(async (share: FolderShare) => {
        const confirmed = await Modal.confirm(
            t('machine.sharedFolders.stopTitle', { folder: `~/${share.folder}` }),
            t('machine.sharedFolders.stopBody', { machine: machineName(share.serverMachineId) }),
            { confirmText: t('machine.sharedFolders.stopAction'), destructive: true },
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            applyChange(
                await machineSharedFolderRemove(machineId, { folder: share.folder, serverMachineId: share.serverMachineId }, { serverId }),
                t('machine.sharedFolders.stopFailedTitle'),
            );
        } finally {
            setBusy(false);
        }
    }, [applyChange, machineId, machineName, serverId]);

    const shares = state?.status === 'ok' ? state.shares : [];
    const addSubtitle = !isOnline
        ? t('machine.sharedFolders.offline')
        : state === null
            ? t('machine.sharedFolders.loading')
            : state.status === 'unavailable'
                ? t('machine.sharedFolders.unavailable')
                : state.status === 'error'
                    ? t('machine.sharedFolders.loadFailed', { message: state.message ?? t('errors.unknownError') })
                    : state.unsupported
                        ? t('machine.sharedFolders.unsupported', { reason: state.unsupported })
                        : targets.length === 0
                            ? t('machine.sharedFolders.noOtherMachine')
                            : t('machine.sharedFolders.addSubtitle');
    const canAdd = isOnline && state?.status === 'ok' && !state.unsupported && targets.length > 0 && !busy;

    return (
        <ItemGroup title={t('machine.sharedFolders.title')} footer={t('machine.sharedFolders.footer')}>
            {shares.map((share) => {
                const machine = machineName(share.serverMachineId);
                return (
                    <Item
                        key={`${share.serverMachineId}:${share.folder}`}
                        testID={`machine-shared-folder:${share.folder}`}
                        title={`~/${share.folder}`}
                        subtitle={share.state === 'connected'
                            ? t('machine.sharedFolders.connected', { machine, path: share.serverPath })
                            : share.state === 'retrying'
                                ? t('machine.sharedFolders.retrying', { machine, reason: share.error ?? t('errors.unknownError') })
                                : t('machine.sharedFolders.connecting', { machine })}
                        subtitleLines={0}
                        disabled={!isOnline || busy}
                        onPress={() => {
                            void onStop(share);
                        }}
                    />
                );
            })}
            <Item
                testID="machine-shared-folders-add"
                title={t('machine.sharedFolders.add')}
                subtitle={addSubtitle}
                subtitleLines={0}
                disabled={!canAdd}
                loading={busy}
                onPress={() => {
                    void onAdd();
                }}
            />
        </ItemGroup>
    );
}

function sameSharesState(previous: MachineSharedFoldersState | null, next: MachineSharedFoldersState): boolean {
    return previous !== null && JSON.stringify(previous) === JSON.stringify(next);
}
