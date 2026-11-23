import { ConnectedServiceQuotaRefreshResponseV1Schema } from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import { log } from '@/log';
import { sanitizeEndpointErrorMessage } from '@/sync/runtime/connectivity/sanitizeEndpointErrorMessage';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

/**
 * Asks a machine to run its usage round now. The request stored on the relay stays authoritative:
 * a machine that cannot answer still serves it on its next regular round.
 */
export async function connectedServiceQuotaRefreshNow(input: Readonly<{ machineId: string }>): Promise<boolean> {
    try {
        const response = await machineRpcWithServerScope<unknown, Record<string, never>>({
            machineId: input.machineId,
            method: RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_REFRESH,
            payload: {},
            // After a timeout the machine may still be running the round: never send it twice.
            onIssued: () => {},
        });
        const parsed = ConnectedServiceQuotaRefreshResponseV1Schema.safeParse(response);
        if (parsed.success && parsed.data.ok) return true;
        log.log(`[CONNECTED SERVICES] Usage refresh left to the next round: ${parsed.success ? parsed.data.errorCode : 'unsupported_response'}`);
    } catch (error) {
        log.log(`[CONNECTED SERVICES] Usage refresh left to the next round: ${sanitizeEndpointErrorMessage(error) ?? 'machine_rpc_failed'}`);
    }
    return false;
}
