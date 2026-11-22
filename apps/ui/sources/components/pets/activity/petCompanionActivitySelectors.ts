import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { storage } from '@/sync/domains/state/storage';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { resolveLastViewedSessionSeq } from '@/sync/domains/session/readCursor/resolveLastViewedSessionSeq';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { SessionMessages } from '@/sync/store/domains/messages';
import type { SessionPending } from '@/sync/store/domains/pending';

import {
    joinSignatureParts,
    readBoolean,
    readDirectSessionSignature,
    readNumber,
    readRuntimeIssueSignature,
    readString,
} from './petCompanionActivitySignature';

type SelectorSignatureCacheEntry<T> = Readonly<{
    signature: string;
    source: T;
    value: T;
}>;

type TranscriptSelectorSignatureCacheEntry = SelectorSignatureCacheEntry<SessionMessages | undefined> & Readonly<{
    includePreviewSignature: boolean;
}>;

export type PetCompanionSignalState = Readonly<{
    sessionMessages: Readonly<Record<string, SessionMessages | undefined>>;
    sessionPending: Readonly<Record<string, SessionPending | undefined>>;
}>;

function sortSessionsByCreatedAtDescending<T extends Readonly<{ createdAt: number }>>(values: Record<string, T>): T[] {
    return Object.values(values).sort((a, b) => b.createdAt - a.createdAt);
}

function sortSessionsByIdAscending<T extends Readonly<{ id: string }>>(values: Record<string, T>): T[] {
    return Object.values(values).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * What the finished-turn review (`buildSessionTurnReviewInput` → `isSessionListReadyForReview`) reads from a session
 * beyond the fields each signature already carries: its ready event and its reported background work. `seq` stays
 * out: it advances with heartbeats, and the ready event against the read cursor, not the seq, says whether a
 * finished turn is still unseen. The cursor itself is in each signature its own way (see the callers).
 */
function readTurnReviewSignature(session: Session | SessionListRenderableSession): string {
    return joinSignatureParts([
        readNumber(session.latestReadyEventSeq),
        readNumber(session.latestReadyEventAt),
        readString(session.runtimeActivityState),
        readNumber(session.runtimeActivityActiveCount),
    ]);
}

/**
 * Whether the read cursor has reached the session's ready event: the one way the cursor moves the finished-turn review
 * once a ready event exists. A row's unread flag cannot stand in for it (a message after the ready event keeps the row
 * unread after the turn is opened), and the cursor itself would recompute on every read that changes nothing.
 */
function readCursorCoversReadyEvent(session: Session | SessionListRenderableSession): 0 | 1 | '' {
    const cursor = resolveLastViewedSessionSeq(session);
    const readyEventSeq = session.latestReadyEventSeq;
    if (typeof cursor !== 'number' || typeof readyEventSeq !== 'number') return '';
    return cursor >= readyEventSeq ? 1 : 0;
}

function createRenderableActivitySignature(session: SessionListRenderableSession): string {
    const hasExplicitUnreadState = typeof session.hasUnreadMessages === 'boolean';
    const metadata = session.metadata;
    const readState = !hasExplicitUnreadState ? metadata?.readStateV1 : null;
    return joinSignatureParts([
        session.id,
        readNumber(session.createdAt),
        readNumber(session.activeAt),
        readBoolean(session.active),
        session.presence === 'online' ? 1 : 0,
        readNumber(session.archivedAt),
        readNumber(session.pendingCount),
        readNumber(session.pendingBlockedCount),
        hasExplicitUnreadState ? '' : readNumber(session.lastViewedSessionSeq),
        readString(metadata?.name),
        readString(metadata?.path),
        readString(metadata?.homeDir),
        readString(metadata?.host),
        readString(metadata?.machineId),
        readString(metadata?.flavor),
        readDirectSessionSignature(metadata?.directSessionV1),
        readNumber(readState?.sessionSeq),
        readNumber(readState?.pendingActivityAt),
        metadata?.hiddenSystemSession === true ? 1 : 0,
        readBoolean(session.thinking),
        readNumber(session.thinkingAt),
        readString(session.latestTurnStatus),
        readNumber(session.latestTurnStatusObservedAt),
        readNumber(session.meaningfulActivityAt),
        readRuntimeIssueSignature(session.lastRuntimeIssue),
        session.thinking ? '' : readNumber(session.optimisticThinkingAt),
        session.thinking ? '' : readNumber(session.thinkingGraceUntil),
        readString(session.owner),
        readString(session.accessLevel),
        readBoolean(session.canApprovePermissions),
        readBoolean(session.hasPendingPermissionRequests),
        readBoolean(session.hasPendingUserActionRequests),
        readNumber(session.pendingRequestObservedAt),
        readBoolean(session.hasUnreadMessages),
        session.keepVisibleWhenInactive === true ? 1 : 0,
        session.metadataUnavailable === true ? 1 : 0,
        readTurnReviewSignature(session),
        readCursorCoversReadyEvent(session),
    ]);
}

function createPetCompanionSessionListRenderableSelector(): (
    state: ReturnType<typeof storage.getState>,
) => SessionListRenderableSession[] {
    let cachedById = new Map<string, SelectorSignatureCacheEntry<SessionListRenderableSession>>();
    let cachedResult: SessionListRenderableSession[] = [];
    let cachedResultSignature = '';

    return (state) => {
        const rows = sortSessionsByIdAscending(state.sessionListRenderables ?? {});
        const nextById = new Map<string, SelectorSignatureCacheEntry<SessionListRenderableSession>>();
        const nextRows: SessionListRenderableSession[] = [];
        const resultSignatureParts: string[] = [];

        for (const row of rows) {
            const cached = cachedById.get(row.id);
            const signature = cached?.source === row
                ? cached.signature
                : createRenderableActivitySignature(row);
            const value = cached?.signature === signature ? cached.value : row;
            nextById.set(row.id, { signature, source: row, value });
            nextRows.push(value);
            resultSignatureParts.push(`${row.id}:${signature}`);
        }

        const resultSignature = resultSignatureParts.join('|');
        cachedById = nextById;
        if (resultSignature === cachedResultSignature) {
            return cachedResult;
        }

        cachedResult = nextRows;
        cachedResultSignature = resultSignature;
        return cachedResult;
    };
}

export function usePetCompanionSessionListRenderables(): SessionListRenderableSession[] {
    const selector = React.useMemo(() => createPetCompanionSessionListRenderableSelector(), []);
    return storage(useShallow(selector));
}

function createFallbackSessionActivitySignature(session: Session | SessionListRenderableSession): string {
    const storageSession = session as Partial<Session>;
    const renderableSession = session as Partial<SessionListRenderableSession>;
    const metadata = session.metadata;
    return joinSignatureParts([
        session.id,
        readNumber(session.createdAt),
        readNumber(session.activeAt),
        readBoolean(session.active),
        session.presence === 'online' ? 1 : 0,
        readNumber(session.archivedAt),
        readNumber(session.agentStateVersion),
        readNumber(session.pendingCount),
        readNumber(storageSession.pendingBlockedCount ?? renderableSession.pendingBlockedCount),
        readNumber(storageSession.pendingPermissionRequestCount),
        readNumber(storageSession.pendingUserActionRequestCount),
        readString(metadata?.name),
        readString(metadata?.path),
        readString(metadata?.homeDir),
        readString(metadata?.host),
        readString(metadata?.machineId),
        readString(metadata?.flavor),
        readDirectSessionSignature(metadata?.directSessionV1),
        metadata?.hiddenSystemSession === true ? 1 : 0,
        readBoolean(session.thinking),
        readNumber(session.thinkingAt),
        readString(session.latestTurnStatus),
        readNumber(session.latestTurnStatusObservedAt),
        readNumber(session.meaningfulActivityAt),
        readRuntimeIssueSignature(session.lastRuntimeIssue),
        session.thinking ? '' : readNumber(session.optimisticThinkingAt),
        session.thinking ? '' : readNumber(session.thinkingGraceUntil),
        readString(session.owner),
        readString(session.accessLevel),
        readBoolean(session.canApprovePermissions),
        readBoolean(renderableSession.hasPendingPermissionRequests),
        readBoolean(renderableSession.hasPendingUserActionRequests),
        readNumber(renderableSession.pendingRequestObservedAt),
        readBoolean(renderableSession.hasUnreadMessages),
        renderableSession.keepVisibleWhenInactive === true ? 1 : 0,
        renderableSession.metadataUnavailable === true ? 1 : 0,
        readTurnReviewSignature(session),
        // A store session has no unread flag that follows its cursor: opening it is seen here.
        readNumber(resolveLastViewedSessionSeq(session)),
    ]);
}

function createPetCompanionFallbackSessionsSelector(rowSessionIds: readonly string[]): (
    state: ReturnType<typeof storage.getState>,
) => Session[] {
    let cachedById = new Map<string, SelectorSignatureCacheEntry<Session>>();
    let cachedResult: Session[] = [];
    let cachedResultSignature = '';

    return (state) => {
        if (!state.isDataReady) return [];

        const rowSessionIdSet = new Set(rowSessionIds);
        const nextById = new Map<string, SelectorSignatureCacheEntry<Session>>();
        const nextSessions: Session[] = [];
        const resultSignatureParts: string[] = [];
        const sessions = sortSessionsByCreatedAtDescending(state.sessions ?? {});

        for (const session of sessions) {
            if (rowSessionIdSet.has(session.id)) continue;
            if (!isUserFacingSession(session)) continue;
            const cached = cachedById.get(session.id);
            const signature = cached?.source === session
                ? cached.signature
                : createFallbackSessionActivitySignature(session);
            const value = cached?.signature === signature ? cached.value : session;
            nextById.set(session.id, { signature, source: session, value });
            nextSessions.push(value);
            resultSignatureParts.push(`${session.id}:${signature}`);
        }

        const resultSignature = resultSignatureParts.join('|');
        cachedById = nextById;
        if (resultSignature === cachedResultSignature) {
            return cachedResult;
        }

        cachedResult = nextSessions;
        cachedResultSignature = resultSignature;
        return cachedResult;
    };
}

export function usePetCompanionFallbackSessions(rowSessionIds: readonly string[]): Session[] {
    const selector = React.useMemo(
        () => createPetCompanionFallbackSessionsSelector(rowSessionIds),
        [rowSessionIds],
    );
    return storage(useShallow(selector));
}

function createToolSubtitleSignature(message: Message): string | null {
    if (message.kind !== 'tool-call') return null;
    return joinSignatureParts([
        message.kind,
        message.id,
        message.createdAt,
        message.tool.id,
        message.tool.name,
        message.tool.description ?? null,
        ...message.children.flatMap((child) => {
            const signature = createToolSubtitleSignature(child);
            return signature ? [signature] : [];
        }),
    ]);
}

function normalizeMessageSubtitleForSignature(message: Message): string | null {
    switch (message.kind) {
        case 'agent-text':
            return readString(message.text).replace(/\s+/g, ' ').trim() || null;
        case 'user-text':
            return readString(message.displayText ?? message.text).replace(/\s+/g, ' ').trim() || null;
        case 'tool-call':
            return readString(message.tool.description || message.tool.name).replace(/\s+/g, ' ').trim() || null;
        case 'agent-event':
            return null;
    }
}

function createMessagePreviewSignature(message: Message | undefined): string {
    if (!message) return 'missing';
    return joinSignatureParts([
        message.kind,
        message.id,
        readNumber(message.createdAt),
        normalizeMessageSubtitleForSignature(message),
    ]);
}

function createLatestSubtitleMessageSignature(
    transcript: SessionMessages,
    messageIds: readonly string[],
): string {
    for (let index = messageIds.length - 1; index >= 0; index -= 1) {
        const messageId = messageIds[index];
        if (!messageId) continue;
        const message = transcript.messagesById?.[messageId] ?? transcript.messagesMap?.[messageId];
        if (!message || normalizeMessageSubtitleForSignature(message) === null) continue;
        return createMessagePreviewSignature(message);
    }
    return 'missing';
}

function hasUnreadActivityForPreviewSignature(session: Session | SessionListRenderableSession | undefined): boolean {
    if (!session) return true;
    const sessionRecord = session as Partial<Session & SessionListRenderableSession>;
    if (typeof sessionRecord.hasUnreadMessages === 'boolean') return sessionRecord.hasUnreadMessages;
    const readableSeq = typeof sessionRecord.latestReadyEventSeq === 'number'
        ? sessionRecord.latestReadyEventSeq
        : sessionRecord.seq;
    return typeof readableSeq === 'number'
        && typeof sessionRecord.lastViewedSessionSeq === 'number'
        && readableSeq > sessionRecord.lastViewedSessionSeq;
}

function shouldIncludeTranscriptPreviewSignature(session: Session | SessionListRenderableSession | undefined): boolean {
    if (!session) return true;
    const sessionRecord = session as Partial<Session & SessionListRenderableSession>;
    if (sessionRecord.thinking === true) return false;
    if (sessionRecord.latestTurnStatus === 'failed' || sessionRecord.lastRuntimeIssue?.status === 'failed') return true;
    if (
        (sessionRecord.pendingPermissionRequestCount ?? 0) > 0
        || (sessionRecord.pendingUserActionRequestCount ?? 0) > 0
    ) {
        return true;
    }
    if (
        sessionRecord.hasPendingPermissionRequests === true
        || sessionRecord.hasPendingUserActionRequests === true
    ) {
        return true;
    }
    if (hasUnreadActivityForPreviewSignature(session)) return true;
    if (sessionRecord.active === true && sessionRecord.presence !== 0) return false;
    return true;
}

function createTranscriptActivitySignature(
    transcript: SessionMessages | undefined,
    includePreviewSignature: boolean,
): string {
    if (!transcript) return 'missing';
    const messageIds = transcript.messageIdsOldestFirst ?? [];
    const toolSubtitles = includePreviewSignature
        ? messageIds.flatMap((messageId) => {
            const message = transcript.messagesById?.[messageId] ?? transcript.messagesMap?.[messageId];
            if (!message) return [];
            const signature = createToolSubtitleSignature(message);
            return signature ? [signature] : [];
        })
        : [];
    const latestCommittedMessageId = messageIds[messageIds.length - 1] ?? null;
    const latestCommittedMessage = latestCommittedMessageId
        ? transcript.messagesById?.[latestCommittedMessageId] ?? transcript.messagesMap?.[latestCommittedMessageId]
        : undefined;
    return joinSignatureParts([
        joinSignatureParts(toolSubtitles),
        includePreviewSignature ? createMessagePreviewSignature(latestCommittedMessage) : '',
        includePreviewSignature ? createLatestSubtitleMessageSignature(transcript, messageIds) : '',
        transcript.latestThinkingMessageId ?? null,
        transcript.isLoaded === true ? 1 : 0,
        // The finished-turn review reads the newer of this ready event and the session's. It counts when the
        // previews do: not while a turn runs, when it cannot change what the companion shows (the session's own
        // ready event, in the session signatures, always counts).
        includePreviewSignature ? readNumber(transcript.latestReadyEventSeq) : '',
        includePreviewSignature ? readNumber(transcript.latestReadyEventAt) : '',
    ]);
}

function createPetCompanionTranscriptsSelector(sessionIds: readonly string[]): (
    state: ReturnType<typeof storage.getState>,
) => Array<SessionMessages | undefined> {
    let cachedBySessionId = new Map<string, TranscriptSelectorSignatureCacheEntry>();
    let cachedResult: Array<SessionMessages | undefined> = [];
    let cachedResultSignature = '';

    return (state) => {
        const nextBySessionId = new Map<string, TranscriptSelectorSignatureCacheEntry>();
        const nextTranscripts: Array<SessionMessages | undefined> = [];
        const resultSignatureParts: string[] = [];

        for (const sessionId of sessionIds) {
            const transcript = state.sessionMessages?.[sessionId];
            const session = state.sessions?.[sessionId] ?? state.sessionListRenderables?.[sessionId];
            const cached = cachedBySessionId.get(sessionId);
            const includePreviewSignature = shouldIncludeTranscriptPreviewSignature(session);
            const signature = cached !== undefined
                && cached.source === transcript
                && cached.includePreviewSignature === includePreviewSignature
                ? cached.signature
                : createTranscriptActivitySignature(
                    transcript,
                    includePreviewSignature,
                );
            const value = cached?.signature === signature ? cached.value : transcript;
            nextBySessionId.set(sessionId, {
                includePreviewSignature,
                signature,
                source: transcript,
                value,
            });
            nextTranscripts.push(value);
            resultSignatureParts.push(`${sessionId}:${signature}`);
        }

        const resultSignature = resultSignatureParts.join('|');
        cachedBySessionId = nextBySessionId;
        if (resultSignature === cachedResultSignature) {
            return cachedResult;
        }

        cachedResult = nextTranscripts;
        cachedResultSignature = resultSignature;
        return cachedResult;
    };
}

function createPendingActivitySignature(pending: SessionPending | undefined): string {
    if (!pending) return 'missing';
    return joinSignatureParts([
        joinSignatureParts(pending.messages.map((message) => joinSignatureParts([
            message.id,
            message.localId,
            readNumber(message.createdAt),
            readString(message.deliveryStatus),
            readString(message.pendingDecryptFailure?.kind),
        ]))),
        joinSignatureParts(pending.discarded.map((message) => joinSignatureParts([
            message.id,
            readNumber(message.createdAt),
            readNumber(message.discardedAt),
            readString(message.discardedReason),
        ]))),
        pending.isLoaded === true ? 1 : 0,
    ]);
}

function createPetCompanionPendingSelector(sessionIds: readonly string[]): (
    state: ReturnType<typeof storage.getState>,
) => Array<SessionPending | undefined> {
    let cachedBySessionId = new Map<string, SelectorSignatureCacheEntry<SessionPending | undefined>>();
    let cachedResult: Array<SessionPending | undefined> = [];
    let cachedResultSignature = '';

    return (state) => {
        const nextBySessionId = new Map<string, SelectorSignatureCacheEntry<SessionPending | undefined>>();
        const nextPendingRows: Array<SessionPending | undefined> = [];
        const resultSignatureParts: string[] = [];

        for (const sessionId of sessionIds) {
            const pending = state.sessionPending?.[sessionId];
            const cached = cachedBySessionId.get(sessionId);
            const signature = cached !== undefined && cached.source === pending
                ? cached.signature
                : createPendingActivitySignature(pending);
            const value = cached?.signature === signature ? cached.value : pending;
            nextBySessionId.set(sessionId, { signature, source: pending, value });
            nextPendingRows.push(value);
            resultSignatureParts.push(`${sessionId}:${signature}`);
        }

        const resultSignature = resultSignatureParts.join('|');
        cachedBySessionId = nextBySessionId;
        if (resultSignature === cachedResultSignature) {
            return cachedResult;
        }

        cachedResult = nextPendingRows;
        cachedResultSignature = resultSignature;
        return cachedResult;
    };
}

export function usePetCompanionSignalState(sessionIds: readonly string[]): PetCompanionSignalState {
    const transcriptsSelector = React.useMemo(
        () => createPetCompanionTranscriptsSelector(sessionIds),
        [sessionIds],
    );
    const pendingSelector = React.useMemo(
        () => createPetCompanionPendingSelector(sessionIds),
        [sessionIds],
    );
    const transcripts = storage(useShallow(transcriptsSelector));
    const pendingRows = storage(useShallow(pendingSelector));

    return React.useMemo(() => {
        const sessionMessages: Record<string, SessionMessages | undefined> = {};
        const sessionPending: Record<string, SessionPending | undefined> = {};

        for (let index = 0; index < sessionIds.length; index += 1) {
            const sessionId = sessionIds[index];
            if (!sessionId) continue;
            sessionMessages[sessionId] = transcripts[index];
            sessionPending[sessionId] = pendingRows[index];
        }

        return { sessionMessages, sessionPending };
    }, [pendingRows, sessionIds, transcripts]);
}
