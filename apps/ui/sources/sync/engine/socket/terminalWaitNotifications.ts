import { notifyActivityTerminalWait } from '@/activity/notifications/runtime/activityLocalNotificationBus';
import { parsePlainSessionAgentState } from '@/sync/engine/sessions/parsePlainSessionPayload';
import { TerminalWaitingSchema, type TerminalWaiting } from '@/sync/domains/state/storageTypes';

/** What the app already knows of a session's pending requests: its list row, or else the retained session. */
export type PendingRequestsProjection = Readonly<{
    hasPendingPermissionRequests?: boolean | null;
    hasPendingUserActionRequests?: boolean | null;
    pendingPermissionRequestCount?: number | null;
    pendingUserActionRequestCount?: number | null;
}>;

type PendingCountsUpdate = Readonly<{
    pendingPermissionRequestCount?: unknown;
    pendingUserActionRequestCount?: unknown;
    agentState?: Readonly<{ version?: unknown; value?: unknown }> | null;
}>;

type AgentStateDecryptor = Readonly<{
    decryptAgentState: (version: number, encrypted: string | null | undefined) => Promise<unknown>;
}>;

function hadPending(flag: boolean | null | undefined, count: number | null | undefined): boolean {
    if (typeof flag === 'boolean') return flag;
    return typeof count === 'number' && count > 0;
}

function hasPending(count: unknown): boolean {
    return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

/**
 * Whether this update makes a session wait for the user where it did not before, read from the public
 * pending counts: the only part of an update the app reads for every session, open or not.
 */
export function didPendingRequestsStart(
    previous: PendingRequestsProjection | null | undefined,
    update: PendingCountsUpdate,
): boolean {
    return (hasPending(update.pendingPermissionRequestCount)
        && !hadPending(previous?.hasPendingPermissionRequests, previous?.pendingPermissionRequestCount))
        || (hasPending(update.pendingUserActionRequestCount)
        && !hadPending(previous?.hasPendingUserActionRequests, previous?.pendingUserActionRequestCount));
}

async function readTerminalWaiting(params: Readonly<{
    update: PendingCountsUpdate;
    encryptionMode: 'plain' | 'e2ee' | null;
    sessionEncryption: AgentStateDecryptor | null;
}>): Promise<TerminalWaiting | null> {
    const envelope = params.update.agentState;
    if (!envelope) return null;
    const encryptionMode = params.encryptionMode ?? (params.sessionEncryption ? 'e2ee' : 'plain');
    let agentState: unknown;
    if (encryptionMode === 'plain') {
        agentState = parsePlainSessionAgentState(typeof envelope.value === 'string' ? envelope.value : null);
    } else {
        if (!params.sessionEncryption || typeof envelope.version !== 'number') return null;
        agentState = await params.sessionEncryption.decryptAgentState(
            envelope.version,
            typeof envelope.value === 'string' ? envelope.value : null,
        );
    }
    const parsed = TerminalWaitingSchema.safeParse((agentState as { terminalWaiting?: unknown } | null)?.terminalWaiting);
    return parsed.success ? parsed.data : null;
}

/**
 * Tells the user when a 「终端」 session's terminal starts waiting for them (a prompt, or a CLI that quit
 * with an error), for every session the app lists, open or not. Rising pending counts are the cue; the
 * update's own agent state says whether it is a terminal that waits and for what, read off the update's
 * path. Chat sessions' requests keep their own notification. Resolves once it is done (for tests).
 */
export function announceTerminalWaitStart(params: Readonly<{
    sessionId: string;
    previous: PendingRequestsProjection | null | undefined;
    update: PendingCountsUpdate;
    /** The session's mode when the app holds the session; a list row alone does not say. */
    encryptionMode: 'plain' | 'e2ee' | null;
    sessionEncryption: AgentStateDecryptor | null;
}>): Promise<void> | null {
    if (!didPendingRequestsStart(params.previous, params.update)) return null;
    return readTerminalWaiting(params)
        .then((waiting) => {
            if (waiting) notifyActivityTerminalWait(params.sessionId, waiting);
        })
        .catch((error) => {
            console.warn('[terminal-wait] Could not read what the terminal waits for', error);
        });
}
