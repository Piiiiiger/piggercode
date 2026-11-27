import { AgyAccountSwitchConfirmResponseV1Schema } from '@piggercode/protocol';

import { isRpcMethodNotAvailableError, isRpcMethodNotFoundError } from '@/sync/runtime/rpcErrors';
import { sessionRpcWithPreferredSessionScope } from '@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope';
import { AGY_ACCOUNT_SWITCH_CONFIRM_METHOD } from '@/sync/domains/connectedServices/agyAccountSwitch';

/**
 * `done`: the runner took the confirmation. `stale`: that request is gone or replaced (the banner follows the
 * metadata). `unsupported`: the machine's PiggerCode is too old to know the method. `failed`: nothing was sent
 * or answered, a retry is fine.
 */
export type AgyAccountSwitchConfirmResult = 'done' | 'stale' | 'unsupported' | 'failed';

/** 「确认换号」: skips only the background-task check of a pending switch (CONTRACT: agy-autoswitch, D9). */
export async function confirmAgyAccountSwitch(input: Readonly<{
    sessionId: string;
    requestId: string;
}>): Promise<AgyAccountSwitchConfirmResult> {
    let response: unknown;
    try {
        response = await sessionRpcWithPreferredSessionScope<unknown, { requestId: string }>({
            sessionId: input.sessionId,
            method: AGY_ACCOUNT_SWITCH_CONFIRM_METHOD,
            payload: { requestId: input.requestId },
        });
    } catch (error) {
        return isRpcMethodNotAvailableError(error) || isRpcMethodNotFoundError(error)
            ? 'unsupported'
            : 'failed';
    }
    const parsed = AgyAccountSwitchConfirmResponseV1Schema.safeParse(response);
    if (!parsed.success) return 'failed';
    if (parsed.data.ok) return 'done';
    return parsed.data.reason === 'not_supported' ? 'unsupported' : 'stale';
}
