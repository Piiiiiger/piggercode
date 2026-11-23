import * as React from 'react';

import {
    ConnectedServicesManagementV1Schema,
    isConnectedServiceSubscriptionLogin,
    type ConnectedServiceId,
} from '@piggercode/protocol';

import { useAllMachines } from '@/sync/domains/state/storage';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { useSetting } from '@/sync/store/hooks';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

/** The online machine to ask for this account's usage work; the daemon enforces the same rule. */
export function resolveConnectedServiceUsageMachineTarget(params: Readonly<{
    serviceId: ConnectedServiceId;
    machines: ReadonlyArray<Machine>;
    managingMachineId: string | null;
}>): string | null {
    if (!isConnectedServiceSubscriptionLogin(params.serviceId)) {
        return params.machines.find((machine) => isMachineOnline(machine))?.id ?? null;
    }
    const managing = params.machines.find((machine) => machine.id === params.managingMachineId);
    return managing && isMachineOnline(managing) ? managing.id : null;
}

export function useConnectedServiceUsageMachineTarget(serviceId: ConnectedServiceId): string | null {
    const machines = useAllMachines();
    const storedManagement = useSetting('connectedServicesManagementV1');
    const managingMachineId = React.useMemo(() => {
        const parsed = ConnectedServicesManagementV1Schema.safeParse(storedManagement);
        return parsed.success ? parsed.data.managingMachineId : null;
    }, [storedManagement]);

    return React.useMemo(() => resolveConnectedServiceUsageMachineTarget({
        serviceId,
        machines,
        managingMachineId,
    }), [machines, managingMachineId, serviceId]);
}
