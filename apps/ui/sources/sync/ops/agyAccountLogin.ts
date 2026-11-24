import {
    AgyAccountLoginResponseV1Schema,
    type AgyAccountLoginRequestV1,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import { log } from '@/log';
import { sanitizeEndpointErrorMessage } from '@/sync/runtime/connectivity/sanitizeEndpointErrorMessage';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

export type AgyAccountLoginStep =
    | Readonly<{ kind: 'started'; loginId: string; accountId: string; url: string }>
    | Readonly<{ kind: 'signed_in'; accountId: string }>
    | Readonly<{ kind: 'cancelled' }>
    /** The machine's answer by its code, or `machine_rpc_failed` when there was none. */
    | Readonly<{ kind: 'failed'; errorCode: string }>;

/**
 * One step of adding a Google login to agy on a machine. The machine runs the official agy; the code the person
 * pastes travels only in this RPC, which the machine accepts only end-to-end encrypted.
 */
export async function runAgyAccountLoginStep(input: Readonly<{
    machineId: string;
    request: AgyAccountLoginRequestV1;
}>): Promise<AgyAccountLoginStep> {
    let errorCode: string;
    try {
        const response = await machineRpcWithServerScope<unknown, AgyAccountLoginRequestV1>({
            machineId: input.machineId,
            method: RPC_METHODS.DAEMON_AGY_ACCOUNT_LOGIN,
            payload: input.request,
            // Sent once, with no fallback: a second start would start a second agy.
            onIssued: () => {},
        });
        const parsed = AgyAccountLoginResponseV1Schema.safeParse(response);
        if (!parsed.success) errorCode = 'invalid_response';
        else if (!parsed.data.ok) errorCode = parsed.data.errorCode;
        else if (parsed.data.action === 'start') {
            return { kind: 'started', loginId: parsed.data.loginId, accountId: parsed.data.accountId, url: parsed.data.url };
        } else if (parsed.data.action === 'submit') return { kind: 'signed_in', accountId: parsed.data.accountId };
        else return { kind: 'cancelled' };
    } catch (error) {
        log.log(`[CONNECTED SERVICES] Gemini login step failed: ${sanitizeEndpointErrorMessage(error) ?? 'machine_rpc_failed'}`);
        return { kind: 'failed', errorCode: 'machine_rpc_failed' };
    }
    log.log(`[CONNECTED SERVICES] Gemini login step refused: ${errorCode}`);
    return { kind: 'failed', errorCode };
}
