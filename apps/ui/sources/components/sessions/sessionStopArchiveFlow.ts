import { HappyError } from '@/utils/errors/errors';
import { storage } from '@/sync/domains/state/storage';
import { AsyncTimeoutError, delay } from '@/utils/timing/time';
import { t } from '@/text';
import type { SessionStopRecovery } from '@/sync/ops/sessionStopContract';
import { readSessionArchivePending, resolveSessionArchiveServerId } from '@/sync/domains/session/listing/sessionArchiveState';
import { withSessionArchiveDeadline, type SessionArchiveRequestOptions } from '@/sync/ops/sessionArchiveLifecycle';

type SessionMutationResult = Readonly<{
    success: boolean;
    message?: string;
    code?: string;
    recovery?: SessionStopRecovery;
}>;

export type StopSessionAndMaybeArchiveParams = Readonly<{
    sessionId: string;
    serverId?: string | null;
    hideInactiveSessions: boolean;
    isPinned: boolean;
    archiveAfterStop: 'never' | 'always';
    stopSession: () => Promise<SessionMutationResult>;
    archiveSession: (options?: SessionArchiveRequestOptions) => Promise<SessionMutationResult>;
    stopErrorMessage: string;
    archiveErrorMessage: string;
}>;

function readSessionArchiveAfterStopRetryDelayMsFromEnv(): number {
    const raw = String(process.env.EXPO_PUBLIC_PIGGERCODE_SESSION_ARCHIVE_AFTER_STOP_RETRY_MS ?? '').trim();
    if (!raw) return 200;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return 200;
    return Math.max(0, Math.min(5_000, parsed));
}

export function isSessionActiveArchiveResult(result: SessionMutationResult): boolean {
    return result.success === false && result.code === 'session_active';
}

export function resolveSessionStopFailureMessage(
    result: SessionMutationResult,
    fallbackMessage: string,
): string {
    if (result.recovery === 'retry_when_runtime_available') {
        return t('sessionInfo.stopSessionControlUnavailable');
    }
    return result.message || fallbackMessage;
}

async function archiveAfterStopWithRetry(params: Readonly<{
    archiveSession: (options?: SessionArchiveRequestOptions) => Promise<SessionMutationResult>;
    archiveErrorMessage: string;
    waitForInactive?: boolean;
}>): Promise<void> {
    try {
        await withSessionArchiveDeadline(async ({ signal, deadlineMs, retryActiveSession }) => {
            let archiveResult = await params.archiveSession({ signal });
            const retryDelayMs = readSessionArchiveAfterStopRetryDelayMsFromEnv();

            while (retryActiveSession && params.waitForInactive !== false && isSessionActiveArchiveResult(archiveResult) && Date.now() < deadlineMs) {
                await delay(Math.min(retryDelayMs, Math.max(0, deadlineMs - Date.now())));
                if (signal.aborted || Date.now() >= deadlineMs) break;
                archiveResult = await params.archiveSession({ signal });
            }

            if (!archiveResult.success) {
                const message = isSessionActiveArchiveResult(archiveResult)
                    ? params.archiveErrorMessage
                    : archiveResult.message || params.archiveErrorMessage;
                throw new HappyError(message, false);
            }
        });
    } catch (error) {
        if (error instanceof AsyncTimeoutError) throw new HappyError(params.archiveErrorMessage, false);
        throw error;
    }
}

export function isSessionArchivePending(sessionId: string, serverId?: string | null): boolean {
    return readSessionArchivePending(storage.getState(), sessionId, resolveSessionArchiveServerId(serverId));
}

export async function archiveSessionWithPendingState<T>(
    sessionId: string,
    archiveSession: () => Promise<T>,
    serverId?: string | null,
): Promise<T | false> {
    // Admission is synchronous, after caller-owned confirmation, and shared by every entry point.
    const operation = storage.getState().beginSessionArchive(sessionId, resolveSessionArchiveServerId(serverId));
    if (!operation) return false;
    try {
        return await archiveSession();
    } finally {
        storage.getState().finishSessionArchive(operation);
    }
}

function isStopAcceptedAndPending(result: SessionMutationResult): boolean {
    return result.success === false
        && result.code === 'session_stop_requested'
        && result.recovery === 'wait_for_inactive';
}

/** Missing runner control permits one archive attempt; only the server can establish inactivity. */
function isStopTargetMissing(result: SessionMutationResult): boolean {
    return result.success === false && result.code === 'session_stop_not_found';
}

async function stopSessionOnly(params: StopSessionAndMaybeArchiveParams): Promise<void> {
    const stopResult = await params.stopSession();
    if (stopResult.success || isStopAcceptedAndPending(stopResult)) return;
    throw new HappyError(resolveSessionStopFailureMessage(stopResult, params.stopErrorMessage), false);
}

/** Whether the session runs, as this device's list of the current server has it; null when it is not there. */
function readSessionActive(sessionId: string): boolean | null {
    const session = storage.getState().sessions[sessionId];
    return session ? session.active === true : null;
}

/** How long a delete waits for a session that was asked to stop to end. */
const STOP_BEFORE_DELETE_WAIT_MS = 15_000;

/**
 * Stops a session that is about to be deleted, so its runner does not keep working on a deleted session (and a
 * linked provider conversation is not written while it is deleted). Resolves to null once its machine stopped
 * it, it has no runner left to stop, or, asked to stop, it ended within 15 s; otherwise to why it could not
 * be stopped. A session this device's list does not show (another server is open now) counts as still running.
 */
export async function stopSessionBeforeDelete(params: Readonly<{
    sessionId: string;
    stopSession: () => Promise<SessionMutationResult>;
    stopErrorMessage: string;
    isActive?: (sessionId: string) => boolean | null;
    waitMs?: number;
    pollMs?: number;
}>): Promise<string | null> {
    let stopResult: SessionMutationResult;
    try {
        stopResult = await params.stopSession();
    } catch (error) {
        return error instanceof Error && error.message ? error.message : params.stopErrorMessage;
    }
    if (stopResult.success || isStopTargetMissing(stopResult)) return null;
    if (!isStopAcceptedAndPending(stopResult)) {
        return resolveSessionStopFailureMessage(stopResult, params.stopErrorMessage);
    }
    const isActive = params.isActive ?? readSessionActive;
    const deadline = Date.now() + (params.waitMs ?? STOP_BEFORE_DELETE_WAIT_MS);
    while (isActive(params.sessionId) !== false) {
        if (Date.now() >= deadline) return t('sessionInfo.stopSessionStillRunning');
        await delay(Math.min(params.pollMs ?? 250, Math.max(0, deadline - Date.now())));
    }
    return null;
}

export async function stopSessionAndMaybeArchive(params: StopSessionAndMaybeArchiveParams): Promise<void | false> {
    if (params.archiveAfterStop === 'never') {
        await stopSessionOnly(params);
        return;
    }

    return archiveSessionWithPendingState(params.sessionId, async () => {
        const stopResult = await params.stopSession();
        const canArchive = stopResult.success
            || isStopAcceptedAndPending(stopResult)
            || isStopTargetMissing(stopResult);
        if (!canArchive) {
            throw new HappyError(resolveSessionStopFailureMessage(stopResult, params.stopErrorMessage), false);
        }
        await archiveAfterStopWithRetry({
            archiveSession: params.archiveSession,
            archiveErrorMessage: params.archiveErrorMessage,
            waitForInactive: !isStopTargetMissing(stopResult),
        });
    }, params.serverId);
}
