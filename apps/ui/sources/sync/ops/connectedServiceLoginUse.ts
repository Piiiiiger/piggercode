import {
    ConnectedServiceLoginUseRequestV1Schema,
    ConnectedServiceLoginUseResponseV1Schema,
    type ConnectedServiceId,
    type ConnectedServiceLoginUseResponseV1,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

/** Asks the managing machine whether a subscription login is in use; `null` when it cannot answer (offline, RPC failure, unreadable reply). */
export async function connectedServiceLoginUse(input: Readonly<{
    machineId: string;
    serviceId: ConnectedServiceId;
    profileId: string;
}>): Promise<ConnectedServiceLoginUseResponseV1 | null> {
    const payload = ConnectedServiceLoginUseRequestV1Schema.parse({
        serviceId: input.serviceId,
        profileId: input.profileId,
    });
    try {
        const response = await machineRpcWithServerScope<unknown, typeof payload>({
            machineId: input.machineId,
            method: RPC_METHODS.DAEMON_CONNECTED_SERVICE_LOGIN_USE,
            payload,
        });
        const parsed = ConnectedServiceLoginUseResponseV1Schema.safeParse(response);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}
