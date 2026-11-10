import { isSessionVisible } from '@/sync/domains/session/activeViewingSession';
import {
    isSessionFullContentConsumerActive,
    sessionScmMutationSignalWanted,
} from '@/sync/domains/session/realtime/sessionRealtimeVisibility';
import {
    readMountedSessionRealtimeScmConsumerScopes,
    resolveSessionRealtimeScmScopeForMountedConsumers,
} from '@/sync/runtime/sessionRealtimeScmConsumers';
import { isSessionRealtimeTranscriptSuppressed } from '@/sync/runtime/sessionRealtimeTranscriptSuppression';
import { readMountedSessionRealtimeTranscriptConsumerSessionIds } from '@/sync/runtime/sessionRealtimeTranscriptConsumers';
import { storage } from '@/sync/domains/state/storage';

export type SessionLiveConsumption = Readonly<{
    isVisible: boolean;
    isFullContentConsumer: boolean;
}>;

/**
 * Single source of truth for "is this session a live-content consumer right now?".
 *
 * Assembles the same reason fan-out the realtime router consumes (visibility, explicit
 * transcript consumers, SCM same-session)
 * so the catch-up policy gate and realtime routing can never diverge.
 *
 * Hidden sessions in the same SCM project scope are intentionally NOT full-content consumers:
 * their workspace-mutation signal is resolved separately via resolveSessionScmMutationSignal
 * and fed from the durable projection path without hydrating their transcripts.
 *
 * Read it at decision time (the visibility signal is a now-decision, not an enqueue-decision).
 */
export function resolveSessionLiveConsumption(
    sessionId: string,
    sourceServerId?: string | null,
): SessionLiveConsumption {
    if (isSessionRealtimeTranscriptSuppressed(sessionId, sourceServerId)) {
        return { isVisible: false, isFullContentConsumer: false };
    }
    const visible = isSessionVisible(sessionId, sourceServerId);
    const scmMountedScopes = readMountedSessionRealtimeScmConsumerScopes();
    const isFullContentConsumer = isSessionFullContentConsumerActive({
        sessionId,
        isVisible: visible,
        explicitTranscriptConsumerSessionIds: readMountedSessionRealtimeTranscriptConsumerSessionIds(sourceServerId),
        sessionScmScope: scmMountedScopes.length > 0
            ? resolveSessionRealtimeScmScopeForMountedConsumers(storage.getState(), sessionId, scmMountedScopes)
            : null,
        scmMountedScopes,
    });
    return { isVisible: visible, isFullContentConsumer };
}

/**
 * Whether a mounted SCM consumer wants workspace-mutation signals from this session.
 *
 * Uses the same suppression gate and SCM scope assembly as resolveSessionLiveConsumption so the
 * projection-path mutation side channel can never diverge from realtime routing/catch-up facts.
 */
export function resolveSessionScmMutationSignal(
    sessionId: string,
    sourceServerId?: string | null,
): boolean {
    if (isSessionRealtimeTranscriptSuppressed(sessionId, sourceServerId)) {
        return false;
    }
    const scmMountedScopes = readMountedSessionRealtimeScmConsumerScopes();
    if (scmMountedScopes.length === 0) {
        return false;
    }
    return sessionScmMutationSignalWanted({
        sessionId,
        sessionScmScope: resolveSessionRealtimeScmScopeForMountedConsumers(storage.getState(), sessionId, scmMountedScopes),
        scmMountedScopes,
    });
}
