import type { EphemeralTaskRunRequest, EphemeralTaskRunResponse } from '@piggercode/protocol';
import { SESSION_RPC_METHODS } from '@piggercode/protocol/rpc';
import { readRpcErrorCode } from '@piggercode/protocol/rpcErrors';

import { sessionRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';

export type SessionEphemeralTaskRunResult =
    | EphemeralTaskRunResponse
    | { ok: false; error: string; errorCode?: string };

export async function sessionEphemeralTaskRun(
    sessionId: string,
    request: EphemeralTaskRunRequest,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionEphemeralTaskRunResult> {
    try {
        const response = await sessionRpcWithServerScope<EphemeralTaskRunResponse, EphemeralTaskRunRequest>({
            sessionId,
            serverId: opts?.serverId ?? resolvePreferredServerIdForSessionId(sessionId),
            method: SESSION_RPC_METHODS.EPHEMERAL_TASK_RUN,
            payload: request,
        });

        if (!response || typeof response !== 'object' || typeof (response as any).ok !== 'boolean') {
            return { ok: false, error: 'Unsupported response from session RPC' };
        }
        return response;
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}
