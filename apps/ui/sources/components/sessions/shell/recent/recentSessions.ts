import {
    normalizeSessionListBackgroundWorkAttentionMode,
    type SessionListBackgroundWorkAttentionMode,
} from '@/sync/domains/session/listing/sessionListBackgroundWorkAttention';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

import {
    resolveSessionListRowAttention,
    resolveSessionListRowMeaningfulActivityAt,
    resolveSessionListRowSession,
} from '../row/buildSessionListRowModel';
import type { SessionListRowStateSnapshot } from '../row/sessionListRowModelTypes';

type SessionRow = Extract<SessionListViewItem, { type: 'session' }>;

/** How many sessions the 「最近」 box shows (the owner chose five, 2026-11-14). */
export const RECENT_SESSIONS_LIMIT = 5;
/** The box's collapse key among the list's collapsed groups, and its rows' group. */
export const RECENT_SESSIONS_GROUP_KEY = 'recent';

/** A session the box may show, by its list key (`<serverId>:<sessionId>`, or the id alone). */
export type RecentSessionCandidate = Readonly<{
    key: string;
    /** The session's list item: its snapshot and its placement. */
    row: SessionRow;
    /** What the session's row reads from the store (live session, messages, pending), so the box ranks it as it shows. */
    state?: Partial<SessionListRowStateSnapshot>;
}>;

export function recentSessionKey(row: SessionRow): string {
    const serverId = typeof row.serverId === 'string' ? row.serverId.trim() : '';
    return serverId ? `${serverId}:${row.session.id}` : row.session.id;
}

/** Where a session stands in the box: whether its row has something to tell the user, and its row's time. */
export type RecentSessionRank = Readonly<{
    key: string;
    tellsUser: boolean;
    at: number;
}>;

/**
 * Where a session stands in the 「最近」 box, from what its row shows: whether the row has something to tell the
 * user (a running turn, a prompt waiting for them, a finished turn they have not opened, a failure: the row's own
 * attention state, so the box and its rows agree) and the time the row shows (its last meaningful activity: a turn's
 * end, or the user typing into it). `backgroundWorkAttentionMode` is the rows' setting.
 */
export function rankRecentSessionCandidate(
    candidate: RecentSessionCandidate,
    nowMs: number,
    backgroundWorkAttentionMode?: SessionListBackgroundWorkAttentionMode,
): RecentSessionRank {
    const session = resolveSessionListRowSession(candidate.state?.renderable, candidate.row.session);
    const { rowAttentionState } = resolveSessionListRowAttention({
        session,
        state: candidate.state,
        sessionState: getSessionStatus(session, nowMs).state,
        backgroundWorkAttentionMode: normalizeSessionListBackgroundWorkAttentionMode(backgroundWorkAttentionMode),
        workingPlacementReason: candidate.row.workingPlacementReason,
    });
    return {
        key: candidate.key,
        tellsUser: rowAttentionState !== 'quiet',
        at: resolveSessionListRowMeaningfulActivityAt(candidate.state ?? {}, session) ?? 0,
    };
}

/**
 * The sessions the 「最近」 box shows, at most `limit`: first the ones whose row has something to tell the user,
 * then the rest, done and already seen or stopped, which are therefore the first a newer session replaces; each
 * part newest first by the time its row shows.
 */
export function orderRecentSessionKeys(
    ranks: ReadonlyArray<RecentSessionRank>,
    limit: number = RECENT_SESSIONS_LIMIT,
): string[] {
    return [...ranks]
        .sort((a, b) => (Number(b.tellsUser) - Number(a.tellsUser))
            || (b.at - a.at)
            || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .slice(0, Math.max(0, limit))
        .map((entry) => entry.key);
}

/** The keys the 「最近」 box shows out of `candidates` (`rankRecentSessionCandidate`, then `orderRecentSessionKeys`). */
export function selectRecentSessionKeys(
    candidates: ReadonlyArray<RecentSessionCandidate>,
    nowMs: number,
    options: Readonly<{
        /** The rows' setting for background work (whether it shows as working or unread). */
        backgroundWorkAttentionMode?: SessionListBackgroundWorkAttentionMode;
        limit?: number;
    }> = {},
): string[] {
    return orderRecentSessionKeys(
        candidates.map((candidate) => rankRecentSessionCandidate(candidate, nowMs, options.backgroundWorkAttentionMode)),
        options.limit,
    );
}

// A box row keeps its object while its session row is the same, so a re-rank re-renders nothing.
const recentRows = new WeakMap<SessionRow, SessionRow>();

/** A session row as the box shows it: a flat leaf of its own group, whatever folder it sits in. */
export function toRecentSessionRow(row: SessionRow): SessionRow {
    const cached = recentRows.get(row);
    if (cached) return cached;
    const placed: SessionRow = {
        ...row,
        groupKey: RECENT_SESSIONS_GROUP_KEY,
        groupKind: 'recent',
        treeKey: RECENT_SESSIONS_GROUP_KEY,
        folderDepth: 0,
    };
    recentRows.set(row, placed);
    return placed;
}
