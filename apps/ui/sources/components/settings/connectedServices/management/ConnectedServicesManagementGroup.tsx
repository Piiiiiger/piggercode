import * as React from 'react';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Icon } from '@/components/ui/icons/Icon';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Item } from '@/components/ui/lists/Item';
import { Modal } from '@/modal';
import { useAllMachines, useSetting } from '@/sync/store/hooks';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { CONNECTED_SERVICES_MANAGEMENT_MIN_CLI_VERSION, ConnectedServicesManagementV1Schema, DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1 } from '@piggercode/protocol';

import {
    changeManagingMachine,
    setConnectedServicePoolsPaused,
    type ConnectedServicesManagementCommandVerdict,
} from './connectedServicesManagementCommands';

const NO_MACHINE_ID = '__none__';

function refusalMessage(verdict: Exclude<ConnectedServicesManagementCommandVerdict, { ok: true }>): string {
    switch (verdict.reason) {
        case 'enrolled_profiles':
            return t('connectedServices.management.refused.enrolledProfiles');
        case 'incompatible_machines':
            return t('connectedServices.management.refused.incompatibleMachines', {
                machines: verdict.machineNames.join(', '),
                version: CONNECTED_SERVICES_MANAGEMENT_MIN_CLI_VERSION,
            });
        case 'unconfirmed':
            return t('connectedServices.management.refused.unconfirmed');
    }
}

function alertOnRefusal(verdict: ConnectedServicesManagementCommandVerdict): void {
    if (!verdict.ok) void Modal.alert(t('common.error'), refusalMessage(verdict));
}

export function ConnectedServicesManagementGroup() {
    const { theme } = useUnistyles();
    const isWeb = Platform.OS === 'web';
    const machines = useAllMachines();
    const storedManagement = useSetting('connectedServicesManagementV1');
    // Normalized like the other connected-services settings: a missing or malformed value manages nothing.
    const management = React.useMemo(() => {
        const parsed = ConnectedServicesManagementV1Schema.safeParse(storedManagement);
        return parsed.success ? parsed.data : DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1;
    }, [storedManagement]);
    const [menuOpen, setMenuOpen] = React.useState(false);

    const currentMachineId = management.managingMachineId;
    const currentMachine = machines.find((machine) => machine.id === currentMachineId) ?? null;
    const currentName = currentMachineId === null
        ? t('connectedServices.management.notSet')
        : getMachineDisplayName(currentMachine ?? { id: currentMachineId }) ?? currentMachineId;

    const items = React.useMemo((): readonly DropdownMenuItem[] => [
        {
            id: NO_MACHINE_ID,
            title: t('connectedServices.management.notSet'),
            icon: <Icon name="x-circle" size={20} color={theme.colors.text.secondary} />,
        },
        ...machines.map((machine) => ({
            id: machine.id,
            title: getMachineDisplayName(machine) ?? machine.id,
            icon: <Icon name="desktop" size={20} color={theme.colors.accent.blue} />,
        })),
    ], [machines, theme.colors.accent.blue, theme.colors.text.secondary]);

    // Both writes decide on the server's current settings, accounts and machines, not on what this page loaded.
    const handleSelect = React.useCallback((itemId: string) => {
        const nextMachineId = itemId === NO_MACHINE_ID ? null : itemId;
        if (nextMachineId === currentMachineId) return;
        void changeManagingMachine(nextMachineId).then(alertOnRefusal);
    }, [currentMachineId]);

    const setPoolsPaused = React.useCallback((poolsPaused: boolean) => {
        void setConnectedServicePoolsPaused(poolsPaused).then(alertOnRefusal);
    }, []);

    return (
        <ItemGroup
            title={t('connectedServices.management.title')}
            footer={t('connectedServices.management.footer')}
        >
            <DropdownMenu
                open={menuOpen}
                onOpenChange={setMenuOpen}
                variant="selectable"
                search={false}
                selectedId={currentMachineId ?? NO_MACHINE_ID}
                showCategoryTitles={false}
                matchTriggerWidth={true}
                connectToTrigger={true}
                rowKind="item"
                itemTrigger={{
                    title: t('connectedServices.management.machineTitle'),
                    icon: <Icon name="desktop" size={20} color={theme.colors.accent.blue} />,
                    showSelectedSubtitle: false,
                    detailFormatter: () => currentName,
                    itemProps: { testID: 'connected-services-management-machine' },
                }}
                items={items}
                onSelect={handleSelect}
            />
            <Item
                testID="connected-services-management-pools-paused"
                mode={isWeb ? 'info' : undefined}
                title={t('connectedServices.management.poolsPausedTitle')}
                subtitle={t('connectedServices.management.poolsPausedSubtitle')}
                icon={<Icon name="pause-circle" size={20} color={theme.colors.accent.blue} />}
                rightElement={<Switch compact value={management.poolsPaused} onValueChange={setPoolsPaused} />}
                showChevron={false}
                onPress={isWeb ? undefined : () => setPoolsPaused(!management.poolsPaused)}
            />
        </ItemGroup>
    );
}
