import { readStoredSessionMessagesReadProjectionFromStateLike } from '@/sync/domains/messages/readStoredSessionMessages';
import {
    deriveSessionListAttentionState,
    deriveSessionListMeaningfulActivityAt,
    resolveSessionListUpdatedAt,
    resolveSessionListSecondaryLineMode,
} from '@/sync/domains/session/listing/deriveSessionListActivity';
import {
    resolveSessionTurnCompletionSeen,
    type SessionListReadyForReviewInput,
} from '@/sync/domains/session/listing/sessionListReadyForReview';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import {
    resolveSessionAttentionStanding,
    resolveSessionReminderPresentation,
} from '@/sync/domains/session/organization/attentionStanding';
import { resolveLastViewedSessionSeq } from '@/sync/domains/session/readCursor/resolveLastViewedSessionSeq';
import { resolveSessionReadableSeq } from '@/sync/domains/session/readCursor/resolveSessionReadableSeq';
import type { Session } from '@/sync/domains/state/storageTypes';
import {
    getSessionName,
    getSessionStatus,
    getSessionSubtitle,
    resolveRunningTurnStartedAt,
} from '@/utils/sessions/sessionUtils';
import {
    resolveNextSessionRuntimePresentationFreshnessAtMs,
    readSessionRuntimeLostSinceMs,
} from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';
import { countSessionAgentActivityFromMetadata } from '@/sync/domains/session/agentActivity/countSessionAgentActivityFromMetadata';
import { reconcileAgentActivityEntryObservation, toAgentActivityCountable } from '@/sync/domains/session/agentActivity/deriveAgentActivityEntries';
import { EMPTY_AGENT_ACTIVITY_COUNTS, deriveAgentActivityCounts, type AgentActivityCounts } from '@/sync/domains/session/agentActivity/deriveAgentActivityCounts';
import {
    formatSessionAgentActivityLabel,
    resolveSessionActivityComposerTranslate,
} from '@/components/sessions/workState/sessionActivityPresentation';
import { formatShortRelativeTimeAt } from '@/utils/time/formatShortRelativeTime';
import { t } from '@/text';
import { sessionTagKey } from '../sessionTagUtils';
import { treeRowId } from '../drop-resolution/treeRowId';
import {
    resolveSessionRowAttentionState,
    resolveSessionRowPresentation,
} from './resolveSessionRowPresentation';
import type {
    SessionListRowModel,
    SessionListRowPresentationSettings,
    SessionListRowSessionItem,
    SessionListRowStateSnapshot,
} from './sessionListRowModelTypes';

export type BuildSessionListRowModelInput = Readonly<{
    item: SessionListRowSessionItem;
    state?: Partial<SessionListRowStateSnapshot>;
    isFirst: boolean;
    isLast: boolean;
    isSingle: boolean;
    settings: SessionListRowPresentationSettings;
}>;

type SessionStatusSource = Session | SessionListRenderableSession;

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeFiniteTimestamp(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.trunc(value)
        : null;
}

function normalizeFiniteCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.trunc(value))
        : null;
}

function readPendingCount(snapshot: Partial<SessionListRowStateSnapshot>, session: SessionStatusSource): number {
    const pendingMessages = snapshot.pending?.messages;
    if (Array.isArray(pendingMessages)) return pendingMessages.length;
    const renderableCount = (session as SessionListRenderableSession).pendingCount;
    return normalizeFiniteCount(renderableCount) ?? 0;
}

function readPendingBlockedCount(snapshot: Partial<SessionListRowStateSnapshot>, session: SessionStatusSource): number {
    const renderableCount = (session as SessionListRenderableSession).pendingBlockedCount ?? (session as Session).pendingBlockedCount;
    const normalizedRenderableCount = normalizeFiniteCount(renderableCount);
    if (normalizedRenderableCount !== null) return normalizedRenderableCount;
    const pendingMessages = snapshot.pending?.messages;
    if (Array.isArray(pendingMessages)) {
        return pendingMessages.reduce((count, message) => message.pendingDeliveryStatus === 'blocked' ? count + 1 : count, 0);
    }
    return 0;
}

function resolveLatestCommittedMessageCreatedAt(snapshot: Partial<SessionListRowStateSnapshot>): number | null {
    const messages = snapshot.messages;
    const ids = messages?.messageIdsOldestFirst;
    if (!ids || ids.length === 0) return null;
    const latestMessageId = ids[ids.length - 1] ?? null;
    if (!latestMessageId) return null;
    return normalizeFiniteTimestamp(messages?.messagesById[latestMessageId]?.createdAt);
}

function resolveLatestPendingMessageCreatedAt(snapshot: Partial<SessionListRowStateSnapshot>): number | null {
    let latest: number | null = null;
    for (const pendingMessage of snapshot.pending?.messages ?? []) {
        const createdAt = normalizeFiniteTimestamp(pendingMessage.createdAt);
        if (createdAt === null) continue;
        latest = latest === null ? createdAt : Math.max(latest, createdAt);
    }
    return latest;
}

/** The session a row reads: its list item's snapshot, with the store's live row state over it. */
export function resolveSessionListRowSession(
    storeSession: SessionListRenderableSession | undefined,
    rowSession: Session | SessionListRenderableSession,
): Session | SessionListRenderableSession {
    if (!storeSession) return rowSession;
    const rowRenderable = rowSession as Partial<SessionListRenderableSession>;
    // List items retain structural snapshots while the store supplies live row state.
    // An explicit clear must replace the snapshot's pending flag.
    const hasPendingPermissionRequests =
        storeSession.hasPendingPermissionRequests ?? (rowRenderable.hasPendingPermissionRequests === true);
    const hasPendingUserActionRequests =
        storeSession.hasPendingUserActionRequests ?? (rowRenderable.hasPendingUserActionRequests === true);
    const keepVisibleWhenInactive =
        rowRenderable.keepVisibleWhenInactive === true || storeSession.keepVisibleWhenInactive === true;
    const archiving = rowRenderable.archiving === true;
    const rowPendingBlockedCount = normalizeFiniteCount(rowRenderable.pendingBlockedCount);
    const storePendingBlockedCount = normalizeFiniteCount(storeSession.pendingBlockedCount);
    const pendingBlockedCount = storePendingBlockedCount ?? rowPendingBlockedCount;
    const meaningfulActivityAt =
        typeof rowRenderable.meaningfulActivityAt === 'number'
        && Number.isFinite(rowRenderable.meaningfulActivityAt)
        && (
            typeof storeSession.meaningfulActivityAt !== 'number'
            || rowRenderable.meaningfulActivityAt > storeSession.meaningfulActivityAt
        )
            ? rowRenderable.meaningfulActivityAt
            : storeSession.meaningfulActivityAt ?? null;

    if (
        hasPendingPermissionRequests === storeSession.hasPendingPermissionRequests
        && hasPendingUserActionRequests === storeSession.hasPendingUserActionRequests
        && keepVisibleWhenInactive === storeSession.keepVisibleWhenInactive
        && archiving === (storeSession.archiving === true)
        && pendingBlockedCount === normalizeFiniteCount(storeSession.pendingBlockedCount)
        && meaningfulActivityAt === (storeSession.meaningfulActivityAt ?? null)
    ) {
        return storeSession;
    }

    return {
        ...storeSession,
        archiving,
        hasPendingPermissionRequests,
        hasPendingUserActionRequests,
        keepVisibleWhenInactive,
        ...(pendingBlockedCount === null ? {} : { pendingBlockedCount }),
        meaningfulActivityAt,
    };
}

/** The activity time a row shows in its default (`meaningful`) mode: when the session was last used. */
export function resolveSessionListRowMeaningfulActivityAt(
    snapshot: Partial<SessionListRowStateSnapshot>,
    session: SessionStatusSource,
): number | null {
    return resolveMeaningfulActivityAt(snapshot, session);
}

function resolveMeaningfulActivityAt(
    snapshot: Partial<SessionListRowStateSnapshot>,
    session: SessionStatusSource,
): number | null {
    return deriveSessionListMeaningfulActivityAt({
        sessionCreatedAt: session.createdAt,
        sessionMeaningfulActivityAt: session.meaningfulActivityAt ?? null,
        latestCommittedMessageCreatedAt: resolveLatestCommittedMessageCreatedAt(snapshot),
        latestThinkingActivityAt: snapshot.messages?.latestThinkingMessageActivityAtMs ?? null,
        latestPendingMessageCreatedAt: resolveLatestPendingMessageCreatedAt(snapshot),
    });
}

/**
 * The session's latest ready event: the newer of the transcript's and the session's. A session the user is not
 * looking at gets its new events as session fields only (realtime projection), while the transcript kept from an
 * earlier visit stays where the user left it, so the transcript alone can hold an older turn's ready event.
 */
function resolveLatestReadyEvent(
    snapshot: Partial<Pick<SessionListRowStateSnapshot, 'messages'>>,
    session: SessionStatusSource,
): Readonly<{ seq: number | null; at: number | null }> {
    const transcriptSeq = snapshot.messages?.latestReadyEventSeq ?? null;
    const transcriptAt = snapshot.messages?.latestReadyEventAt ?? null;
    const sessionSeq = (session as Session).latestReadyEventSeq
        ?? (session as SessionListRenderableSession).latestReadyEventSeq
        ?? null;
    const sessionAt = (session as Session).latestReadyEventAt
        ?? (session as SessionListRenderableSession).latestReadyEventAt
        ?? null;
    if (sessionSeq !== null && (transcriptSeq === null || sessionSeq > transcriptSeq)) {
        return { seq: sessionSeq, at: sessionAt };
    }
    return { seq: transcriptSeq ?? sessionSeq, at: transcriptAt ?? sessionAt };
}

function resolveHasUnreadMessages(
    snapshot: Partial<SessionListRowStateSnapshot>,
    session: SessionStatusSource,
): boolean {
    const readableSeq = resolveSessionReadableSeq({
        messagesProjection: readStoredSessionMessagesReadProjectionFromStateLike(snapshot.messages),
        sessionSeq: session.seq,
        latestReadyEventSeq: resolveLatestReadyEvent(snapshot, session).seq,
        latestTurnStatus: session.latestTurnStatus ?? null,
        includeTerminalSessionSeq: true,
    });
    const lastViewedSessionSeq = resolveLastViewedSessionSeq(session) ?? null;
    if (readableSeq !== null) {
        return readableSeq > (lastViewedSessionSeq ?? 0);
    }
    return (session as SessionListRenderableSession).hasUnreadMessages === true;
}

/**
 * What agent work is live, from whichever shape of session this row was handed.
 *
 * A renderable-backed row carries the tally already projected (see `SessionListRenderableMetadata`),
 * which is the path every virtualized list row takes. A row backed by a full store session — the
 * fallback when no renderable exists — computes it from real metadata through the same owner, so the
 * two paths cannot produce different numbers.
 */
function readSessionAgentActivityCounts(session: SessionStatusSource, nowMs: number): AgentActivityCounts {
    const runtimeLostSinceMs = readSessionRuntimeLostSinceMs(session, nowMs);
    const metadata = (session as SessionListRenderableSession).metadata;
    if (runtimeLostSinceMs !== null && metadata?.agentActivityEntries) {
        return deriveAgentActivityCounts(metadata.agentActivityEntries.map((entry) => toAgentActivityCountable(reconcileAgentActivityEntryObservation(entry, runtimeLostSinceMs))));
    }
    const projected = (session as SessionListRenderableSession).metadata?.agentActivityCounts;
    if (projected) return runtimeLostSinceMs === null ? projected : EMPTY_AGENT_ACTIVITY_COUNTS;
    return countSessionAgentActivityFromMetadata((session as Session).metadata, runtimeLostSinceMs);
}

function resolveNextRuntimeFreshnessAtMs(session: SessionStatusSource, nowMs: number): number | null {
    return resolveNextSessionRuntimePresentationFreshnessAtMs({
        active: session.active,
        activeAt: session.activeAt,
        presence: session.presence,
        thinking: session.thinking,
        thinkingAt: session.thinkingAt,
        latestTurnStatus: session.latestTurnStatus,
        latestTurnStatusObservedAt: session.latestTurnStatusObservedAt,
        runtimeActivityState: session.runtimeActivityState,
        runtimeActivityActiveCount: session.runtimeActivityActiveCount,
        runtimeActivityObservedAt: session.runtimeActivityObservedAt,
        runtimeActivityRevision: session.runtimeActivityRevision,
        hasPendingPermissionRequests: (session as SessionListRenderableSession).hasPendingPermissionRequests === true,
        hasPendingUserActionRequests: (session as SessionListRenderableSession).hasPendingUserActionRequests === true,
        pendingRequestObservedAt: (session as SessionListRenderableSession).pendingRequestObservedAt ?? null,
    }, nowMs);
}

function buildStatusSignature(status: ReturnType<typeof getSessionStatus>, nextRuntimeFreshnessAtMs: number | null): string {
    return [
        status.state,
        status.isConnected ? '1' : '0',
        status.shouldShowStatus ? '1' : '0',
        status.statusText,
        status.isPulsing === true ? '1' : '0',
        nextRuntimeFreshnessAtMs ?? '',
    ].join('|');
}

function resolveRowIdentityLoading(input: Readonly<{
    session: SessionStatusSource;
    title: string;
}>): boolean {
    const metadataUnavailable = (input.session as SessionListRenderableSession).metadataUnavailable === true;
    return !metadataUnavailable
        && input.session.metadata == null
        && input.title === t('status.unknown');
}

function resolveRowSubtitle(input: Readonly<{
    rowKey: string;
    settings: SessionListRowPresentationSettings;
    session: SessionStatusSource;
}>): Readonly<{ subtitle: string; subtitleEllipsizeMode: 'head' | 'tail' }> {
    const reachableDisplay = input.settings.reachableSessionDisplayByKey[input.rowKey];
    if (reachableDisplay) {
        const workspaceSubtitle = normalizeNonEmptyString(reachableDisplay.workspaceSubtitle) ?? '';
        const machineLabel = normalizeNonEmptyString(reachableDisplay.machineLabel) ?? '';
        return {
            subtitle: input.settings.hasMultipleMachines
                ? (machineLabel && workspaceSubtitle
                    ? `${machineLabel} · ${workspaceSubtitle}`
                    : machineLabel || workspaceSubtitle)
                : workspaceSubtitle,
            subtitleEllipsizeMode: reachableDisplay.workspaceSubtitleEllipsizeMode ?? 'head',
        };
    }

    return {
        subtitle: getSessionSubtitle(input.session),
        subtitleEllipsizeMode: 'head',
    };
}

/**
 * What a session's list row shows about its work (working, waiting on a request, failed, unread, …): the row and an
 * explorer folder (which shows when a session below it works) both read it here, so they never disagree.
 */
type SessionListRowAttentionSource = Readonly<{
    session: SessionStatusSource;
    state?: Partial<SessionListRowStateSnapshot>;
    /** `getSessionStatus(session, nowMs).state` */
    sessionState: ReturnType<typeof getSessionStatus>['state'];
    backgroundWorkAttentionMode: SessionListRowPresentationSettings['backgroundWorkAttentionMode'];
}>;

/**
 * What `sessionListReadyForReview` reads about a session's latest finished turn, from the session and its store
 * snapshot (messages and pending). The row's attention and the pet companion's tray both ask through here, so a
 * finished turn waiting to be looked at (「待查阅」) is one answer wherever it shows.
 */
export function buildSessionTurnReviewInput(
    session: SessionStatusSource,
    state: Partial<Pick<SessionListRowStateSnapshot, 'messages' | 'pending'>> = {},
): SessionListReadyForReviewInput {
    const latestReadyEvent = resolveLatestReadyEvent(state, session);
    return {
        runtimeActivityState: session.runtimeActivityState,
        runtimeActivityActiveCount: session.runtimeActivityActiveCount,
        latestTurnStatus: session.latestTurnStatus ?? null,
        latestTurnStatusObservedAt: normalizeFiniteTimestamp(session.latestTurnStatusObservedAt),
        seq: normalizeFiniteTimestamp(session.seq),
        meaningfulActivityAt: resolveMeaningfulActivityAt(state, session),
        latestReadyEventSeq: latestReadyEvent.seq,
        latestReadyEventAt: latestReadyEvent.at,
        lastViewedSessionSeq: resolveLastViewedSessionSeq(session) ?? null,
    };
}

function buildSessionListRowAttentionInput(input: SessionListRowAttentionSource): Parameters<typeof deriveSessionListAttentionState>[0] {
    const { session } = input;
    const state = input.state ?? {};
    return {
        ...buildSessionTurnReviewInput(session, state),
        hasUnreadMessages: resolveHasUnreadMessages(state, session),
        pendingCount: readPendingCount(state, session),
        pendingBlockedCount: readPendingBlockedCount(state, session),
        sessionState: input.sessionState,
        backgroundWorkAttentionMode: input.backgroundWorkAttentionMode,
        lastRuntimeIssue: session.lastRuntimeIssue ?? null,
    };
}

export function deriveSessionListRowAttentionState(input: SessionListRowAttentionSource): ReturnType<typeof deriveSessionListAttentionState> {
    return deriveSessionListAttentionState(buildSessionListRowAttentionInput(input));
}

/**
 * The attention state a session's list row shows, from the session it reads (`resolveSessionListRowSession`), the row's
 * store snapshot (messages and pending included), its status at `getSessionStatus`'s state, the rows' background-work
 * setting and the item's placement. The one owner of it: the row and a surface that ranks rows by it (the 「最近」 box)
 * read the same answer. `presentsRetainedWorking`: the working state is the placement's (stale live signals held in the
 * working group), which the row presents as a paused working row.
 */
export function resolveSessionListRowAttention(input: Readonly<{
    session: SessionStatusSource;
    state?: Partial<SessionListRowStateSnapshot>;
    sessionState: ReturnType<typeof getSessionStatus>['state'];
    backgroundWorkAttentionMode: SessionListRowPresentationSettings['backgroundWorkAttentionMode'];
    workingPlacementReason?: SessionListRowSessionItem['workingPlacementReason'];
}>): Readonly<{
    listAttentionState: ReturnType<typeof deriveSessionListAttentionState>;
    rowAttentionState: ReturnType<typeof resolveSessionRowAttentionState>;
    presentsArchiving: boolean;
    presentsRetainedWorking: boolean;
    /** Quiet, and its latest finished turn has been looked at: the row says 「已查阅」. */
    presentsReviewed: boolean;
}> {
    const attentionInput = buildSessionListRowAttentionInput(input);
    const listAttentionState = deriveSessionListAttentionState(attentionInput);
    const derivedRowAttentionState = resolveSessionRowAttentionState(listAttentionState);
    // Retained working placement holds the session in the working group while
    // its live signals are stale. Present it as a PAUSED working row (working
    // indicator without animation) unless a more alerting state applies —
    // otherwise the user sees a session in the working group with no
    // indicator at all.
    // A committed archive in flight speaks through the working indicator and the
    // status line ("archiving…" from `getSessionStatus`), whatever the session was doing.
    const presentsArchiving = input.sessionState === 'archiving';
    const presentsRetainedWorking = !presentsArchiving
        && input.workingPlacementReason === 'working-retained'
        && (
            derivedRowAttentionState === 'quiet'
            || derivedRowAttentionState === 'unread'
            || derivedRowAttentionState === 'pending'
        );
    const rowAttentionState = presentsArchiving || presentsRetainedWorking ? 'working' : derivedRowAttentionState;
    return {
        listAttentionState,
        rowAttentionState,
        presentsArchiving,
        presentsRetainedWorking,
        presentsReviewed: rowAttentionState === 'quiet' && resolveSessionTurnCompletionSeen(attentionInput) === 'seen',
    };
}

export function buildSessionListRowModel(input: BuildSessionListRowModelInput): SessionListRowModel {
    const { item, settings } = input;
    const sessionId = String(item.session.id);
    const serverId = normalizeNonEmptyString(item.serverId);
    const rowKey = serverId ? sessionTagKey(serverId, sessionId) : sessionId;
    const resolvedSession = resolveSessionListRowSession(input.state?.renderable, item.session);
    const activityMode: SessionListRowModel['activity']['mode'] = item.groupKind === 'date'
        ? 'updatedAt'
        : 'meaningful';
    const activityTimestamp = activityMode === 'updatedAt'
        ? normalizeFiniteTimestamp(resolveSessionListUpdatedAt({
            sessionCreatedAt: resolvedSession.createdAt,
            sessionUpdatedAt: resolvedSession.updatedAt,
        }))
        : resolveMeaningfulActivityAt(input.state ?? {}, resolvedSession);
    const activityLabel = typeof activityTimestamp === 'number' && activityTimestamp > 0
        ? formatShortRelativeTimeAt(activityTimestamp, settings.relativeNowMs)
        : '';
    const status = getSessionStatus(resolvedSession, settings.runtimeNowMs, {
        workingTextMode: settings.workingTextMode,
        statusColors: settings.statusColors,
    });
    const pendingCount = readPendingCount(input.state ?? {}, resolvedSession);
    const pendingBlockedCount = readPendingBlockedCount(input.state ?? {}, resolvedSession);
    const hasUnreadMessages = resolveHasUnreadMessages(input.state ?? {}, resolvedSession);
    const {
        listAttentionState: attentionState,
        rowAttentionState,
        presentsArchiving,
        presentsRetainedWorking,
        presentsReviewed,
    } = resolveSessionListRowAttention({
        session: resolvedSession,
        state: input.state,
        sessionState: status.state,
        backgroundWorkAttentionMode: settings.backgroundWorkAttentionMode,
        workingPlacementReason: item.workingPlacementReason,
    });
    // Attention standing is the person's own instruction to keep a read, idle
    // session in the band. It comes off the placement reason and stays OUT of the
    // attention state on purpose: the session has nothing new in it, so the row
    // must not take an unread title or badge — it only says why it is still here.
    const presentsAttentionStanding = item.attentionPromotionReason === 'standing';
    const secondaryLineGroupKind = item.groupKind === 'folder' ? 'project' : item.groupKind;
    const secondaryLineMode = resolveSessionListSecondaryLineMode({ groupKind: secondaryLineGroupKind });
    const { subtitle, subtitleEllipsizeMode } = resolveRowSubtitle({
        rowKey,
        settings,
        session: resolvedSession,
    });
    const presentation = resolveSessionRowPresentation({
        attentionState: rowAttentionState,
        density: settings.density,
        requestedSecondaryLineMode: secondaryLineMode,
        hasPathSubtitle: subtitle.trim().length > 0,
        workingRetained: presentsRetainedWorking,
        standing: presentsAttentionStanding,
        reviewed: presentsReviewed,
        backgroundActive: status.state === 'background_active',
        // Pinning lifts a session out of the Active/Inactive sections, whose headers are the
        // only other place a quiet row's liveness is stated.
        statesUnseenLiveness: item.groupKind === 'pinned' && status.shouldShowStatus,
    });
    // Absent unless the person asked for it (R-8): the row model always carries the field so a host
    // cannot invent a second way to get the sentence, and the setting decides whether it is drawn.
    // Composed through the composer chip's own owner, so a row and the session it opens onto cannot
    // describe the same workflow differently.
    const agentActivityLabel = settings.agentActivityCountEnabled
        ? formatSessionAgentActivityLabel(
            readSessionAgentActivityCounts(resolvedSession, settings.runtimeNowMs),
            resolveSessionActivityComposerTranslate(),
        )
        : null;
    const standingRecord = settings.attentionStandingPolicy.overridesBySessionKey[rowKey];
    const reminder = resolveSessionReminderPresentation(standingRecord, settings.runtimeNowMs);
    const reminderWakeAtMs = reminder?.state === 'scheduled' ? reminder.remindAt : null;
    const runtimeWakeAtMs = resolveNextRuntimeFreshnessAtMs(resolvedSession, settings.runtimeNowMs);
    const nextRuntimeFreshnessAtMs = runtimeWakeAtMs === null
        ? reminderWakeAtMs
        : reminderWakeAtMs === null ? runtimeWakeAtMs : Math.min(runtimeWakeAtMs, reminderWakeAtMs);
    const isArchived = resolvedSession.archivedAt != null;
    const isPinned = item.pinned === true || settings.pinnedSessionKeys.includes(rowKey);
    // The STORED instruction, resolved through the policy owner, never the placement reason: a
    // standing session that is currently placed for being unread must still offer to be removed.
    const isAttentionStanding = resolveSessionAttentionStanding(settings.attentionStandingPolicy, rowKey, settings.runtimeNowMs);
    const title = getSessionName(resolvedSession);

    return {
        rowKey,
        sessionId,
        serverId,
        serverName: item.serverName,
        treeRowId: serverId ? treeRowId.session(serverId, sessionId) : `session:${sessionId}`,
        testID: `session-list-item-${sessionId}`,
        session: resolvedSession,
        status,
        statusSignature: buildStatusSignature(status, nextRuntimeFreshnessAtMs),
        nextRuntimeFreshnessAtMs,
        secondaryLineMode,
        attention: {
            listState: attentionState,
            rowState: rowAttentionState,
        },
        presentation,
        workingIndicatorPaused: presentsRetainedWorking,
        activity: {
            mode: activityMode,
            timestamp: activityTimestamp,
            label: activityLabel,
            bucket: activityLabel,
            runningSince: rowAttentionState === 'working' && !presentsArchiving && !presentsRetainedWorking
                ? resolveRunningTurnStartedAt(resolvedSession)
                : null,
        },
        isIdentityLoading: resolveRowIdentityLoading({
            session: resolvedSession,
            title,
        }),
        title,
        subtitle,
        subtitleEllipsizeMode,
        groupKey: String(item.groupKey ?? '').trim(),
        groupKind: item.groupKind ?? null,
        section: item.section ?? null,
        variant: item.variant ?? null,
        folder: {
            id: item.folderId ?? null,
            // User folders and the explorer (rows with a treeKey) both indent rows by folder depth.
            depth: settings.folderViewEnabled || item.treeKey ? Math.max(0, Math.trunc(item.folderDepth ?? 0)) : 0,
            tree: Boolean(item.treeKey),
        },
        adjacency: {
            isFirst: input.isFirst,
            isLast: input.isLast,
            isSingle: input.isSingle,
        },
        isSelected: (item as SessionListRowSessionItem & { selected?: boolean }).selected === true,
        isPinned,
        isAttentionStanding,
        reminder,
        attentionStandingEnabled: settings.attentionStandingEnabled,
        isArchived,
        isActive: resolvedSession.active === true,
        hasUnreadMessages,
        pendingCount,
        pendingBlockedCount,
        draft: input.state?.draft ?? null,
        agentActivityLabel,
        tags: settings.sessionTagsByKey[rowKey] ?? [],
        allKnownTags: settings.allKnownTags,
        tagsEnabled: settings.tagsEnabled,
        currentUserId: settings.currentUserId,
        showServerBadge: isPinned ? settings.showPinnedServerBadge : settings.showServerBadge,
        compact: settings.compact,
        compactMinimal: settings.compactMinimal,
        identityDisplay: settings.identityDisplay,
        activeColorMode: settings.activeColorMode,
        workingIndicatorMode: settings.workingIndicatorMode,
        hideInactiveSessions: settings.hideInactiveSessions,
    };
}
