import {
    AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION,
    AgyAccountUsageReadResponseV1Schema,
    type AgyAccountUsageReadRequestV1,
    type AgyAccountUsageV1,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import { log } from '@/log';
import { sanitizeEndpointErrorMessage } from '@/sync/runtime/connectivity/sanitizeEndpointErrorMessage';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

export type AgyAccountUsageRead =
    /** `refreshed`: after a press of refresh, whether agy reported that login's limits. */
    | Readonly<{ kind: 'ok'; accounts: readonly AgyAccountUsageV1[]; refreshed?: boolean }>
    /** The machine has readings but no end-to-end encryption to send them with. */
    | Readonly<{ kind: 'view_on_machine' }>
    /** An older CLI, or the request failed. */
    | Readonly<{ kind: 'unavailable' }>;

/**
 * Reads a machine's Gemini accounts. They travel only by this RPC: the relay stores none of it. With
 * `refreshAccountId` the machine first starts agy once on that login.
 */
export async function readAgyAccountUsage(input: Readonly<{
    machineId: string;
    refreshAccountId?: string;
}>): Promise<AgyAccountUsageRead> {
    let failure: string;
    try {
        const response = await machineRpcWithServerScope<unknown, AgyAccountUsageReadRequestV1>({
            machineId: input.machineId,
            method: RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ,
            payload: input.refreshAccountId ? { refreshAccountId: input.refreshAccountId } : {},
            // Sent once, with no fallback: a press must not start agy twice, the next read is the retry,
            // and an older CLI costs one call.
            onIssued: () => {},
        });
        const parsed = AgyAccountUsageReadResponseV1Schema.safeParse(response);
        if (!parsed.success) failure = 'invalid_response';
        else if (parsed.data.ok) {
            return {
                kind: 'ok',
                accounts: parsed.data.accounts,
                ...(parsed.data.refreshed === undefined ? {} : { refreshed: parsed.data.refreshed }),
            };
        } else if (parsed.data.errorCode === AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION) return { kind: 'view_on_machine' };
        else failure = parsed.data.errorCode;
    } catch (error) {
        failure = sanitizeEndpointErrorMessage(error) ?? 'machine_rpc_failed';
    }
    log.log(`[CONNECTED SERVICES] Gemini usage not read: ${failure}`);
    return { kind: 'unavailable' };
}
