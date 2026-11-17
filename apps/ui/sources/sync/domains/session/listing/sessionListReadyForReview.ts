import type { PrimaryTurnStatusV1, SessionRuntimeActivityState } from '@piggercode/protocol';

export type SessionListReadyForReviewInput = Readonly<{
    seq?: number | null;
    meaningfulActivityAt?: number | null;
    latestTurnStatus?: PrimaryTurnStatusV1 | null;
    latestTurnStatusObservedAt?: number | null;
    latestReadyEventSeq?: number | null;
    latestReadyEventAt?: number | null;
    lastViewedSessionSeq?: number | null;
    runtimeActivityState?: SessionRuntimeActivityState | null;
    runtimeActivityActiveCount?: number | null;
}>;

export const SESSION_LIST_TERMINAL_ACTIVITY_SKEW_MS = 1_000;

export function isSessionListReadyForReview(input: SessionListReadyForReviewInput): boolean {
    // Losing observation of previously reported work is not evidence that it finished.
    if ((input.runtimeActivityActiveCount ?? 0) > 0 && input.runtimeActivityState !== 'idle') return false;
    return hasUnseenSessionTurnCompletion(input);
}

export function hasUnseenSessionTurnCompletion(input: SessionListReadyForReviewInput): boolean {
    return resolveSessionTurnCompletionSeen(input) === 'unseen';
}

/**
 * Whether the session's latest finished turn has been looked at: `unseen` (it finished after the user last
 * opened the session), `seen`, or null when no finished turn is the latest thing in the session (none finished
 * yet, or a later turn or newer activity followed it). The list says 「待查阅」 for `unseen` and 「已查阅」 for `seen`.
 */
export function resolveSessionTurnCompletionSeen(input: SessionListReadyForReviewInput): 'unseen' | 'seen' | null {
    const lastViewedSeq = normalizeSeq(input.lastViewedSessionSeq) ?? 0;
    const meaningfulActivityAt = normalizeSeq(input.meaningfulActivityAt);
    const readyEventSeq = normalizeSeq(input.latestReadyEventSeq);
    if (readyEventSeq !== null) {
        if (readyEventSeq > lastViewedSeq) return 'unseen';
        // The ready event outlives later turns: it is the latest word only while the latest turn (when the session
        // reports one) completed and nothing happened in the session after it.
        if (input.latestTurnStatus != null && input.latestTurnStatus !== 'completed') return null;
        return happenedAfter(meaningfulActivityAt, normalizeSeq(input.latestReadyEventAt)) ? null : 'seen';
    }
    if (input.latestTurnStatus !== 'completed') {
        return null;
    }
    if (happenedAfter(meaningfulActivityAt, normalizeSeq(input.latestTurnStatusObservedAt))) {
        return null;
    }
    const sessionSeq = normalizeSeq(input.seq);
    if (sessionSeq === null) return null;
    return sessionSeq > lastViewedSeq ? 'unseen' : 'seen';
}

/** Activity at `activityAt` came after `eventAt`, beyond the clock skew a terminal report may carry. */
function happenedAfter(activityAt: number | null, eventAt: number | null): boolean {
    return activityAt !== null && eventAt !== null && activityAt > eventAt + SESSION_LIST_TERMINAL_ACTIVITY_SKEW_MS;
}

function normalizeSeq(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.trunc(value));
}
