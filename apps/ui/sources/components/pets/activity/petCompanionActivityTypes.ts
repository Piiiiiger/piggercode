import type { PetAnimationStateV1 } from '@piggercode/protocol';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';

export type PetCompanionActivitySession = Session | SessionListRenderableSession;

export type PetCompanionActivityStatus =
    Extract<PetAnimationStateV1, 'waiting' | 'failed' | 'review' | 'running' | 'idle'>;

export type PetCompanionActivityReason = PetCompanionActivityStatus;

export type PetCompanionSessionSignals = Readonly<{
    hasFailure: boolean;
    hasPendingPermissionRequests?: boolean;
    hasPendingUserActionRequests?: boolean;
    hasUnreadMessages: boolean;
    latestThinkingActivityAtMs: number | null;
    latestMeaningfulActivityAtMs: number | null;
    lastMessageSubtitle?: string | null;
    pendingMessageCount: number;
    /**
     * Its latest turn finished and nobody has opened the session since: the session list's 「待查阅」
     * (`isSessionListReadyForReview`), asked with the row's own input.
     */
    readyForReview?: boolean;
    /** When that turn finished (its completed status, else its ready event), while `readyForReview`. */
    readyForReviewAtMs?: number | null;
}>;

export type PetCompanionTrayItem = Readonly<{
    id: string;
    dismissKey: string;
    sessionId: string;
    status: Exclude<PetCompanionActivityStatus, 'idle'>;
    priority: number;
    title: string;
    subtitle: string | null;
    activityAtMs: number | null;
    expiresAtMs: number | null;
    actions: Readonly<{
        open: true;
        dismiss: true;
        quickReply: true;
    }>;
}>;

export type PetCompanionActivityModel = Readonly<{
    state: PetCompanionActivityStatus;
    reason: PetCompanionActivityReason;
    sessionId: string | null;
    trayItems: readonly PetCompanionTrayItem[];
}>;

export type BuildPetCompanionActivityModelInput = Readonly<{
    sessions: readonly PetCompanionActivitySession[];
    selectedSessionId?: string | null;
    signalsBySessionId?: Readonly<Record<string, PetCompanionSessionSignals | undefined>>;
    dismissedTrayItemKeys?: ReadonlySet<string> | readonly string[];
    nowMs?: number;
}>;
