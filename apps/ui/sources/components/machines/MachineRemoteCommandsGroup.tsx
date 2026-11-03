import * as React from 'react';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import {
    machineRemoteCommandsGet,
    machineRemoteCommandsSet,
    type MachineRemoteCommandsState,
} from '@/sync/ops/machines';
import { t } from '@/text';

export type MachineRemoteCommandsGroupProps = Readonly<{
    machineId: string;
    machineName: string;
    isOnline: boolean;
    serverId?: string | null;
}>;

/**
 * The machine's remote-commands switch: whether agents on the account's other machines (Claude Code on
 * the server, for example) may run shell commands here. The machine itself keeps the setting, so it can
 * only be read or changed while it is online. Turning it on asks first.
 */
export function MachineRemoteCommandsGroup(props: MachineRemoteCommandsGroupProps) {
    const { machineId, machineName, isOnline, serverId } = props;
    const [state, setState] = React.useState<MachineRemoteCommandsState | null>(null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        setState(null);
        if (!isOnline) return;
        let cancelled = false;
        void machineRemoteCommandsGet(machineId, { serverId }).then((next) => {
            if (!cancelled) setState(next);
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, isOnline, serverId]);

    const onValueChange = React.useCallback(async (next: boolean) => {
        if (next) {
            const confirmed = await Modal.confirm(
                t('machine.remoteCommands.confirmTitle'),
                t('machine.remoteCommands.confirmBody', { machine: machineName }),
                { confirmText: t('machine.remoteCommands.confirmAction'), destructive: true },
            );
            if (!confirmed) return;
        }
        setSaving(true);
        try {
            const result = await machineRemoteCommandsSet(machineId, next, { serverId });
            if (result.status === 'ok') {
                setState(result);
                return;
            }
            Modal.alert(
                t('common.error'),
                result.status === 'unavailable'
                    ? t('machine.remoteCommands.unavailable')
                    : t('machine.remoteCommands.saveFailed', { message: result.message ?? t('errors.unknownError') }),
            );
        } finally {
            setSaving(false);
        }
    }, [machineId, machineName, serverId]);

    const enabled = state?.status === 'ok' && state.enabled;
    const subtitle = !isOnline
        ? t('machine.remoteCommands.offline')
        : state === null
            ? t('machine.remoteCommands.loading')
            : state.status === 'unavailable'
                ? t('machine.remoteCommands.unavailable')
                : state.status === 'error'
                    ? t('machine.remoteCommands.loadFailed', { message: state.message ?? t('errors.unknownError') })
                    : state.enabled
                        ? t('machine.remoteCommands.onSubtitle')
                        : t('machine.remoteCommands.offSubtitle');

    return (
        <ItemGroup title={t('machine.remoteCommands.title')}>
            <Item
                testID="machine-remote-commands"
                title={t('machine.remoteCommands.switchTitle')}
                subtitle={subtitle}
                rightElement={(
                    <Switch
                        testID="machine-remote-commands-switch"
                        value={enabled}
                        disabled={!isOnline || state?.status !== 'ok' || saving}
                        onValueChange={(next) => {
                            void onValueChange(next);
                        }}
                    />
                )}
            />
        </ItemGroup>
    );
}
