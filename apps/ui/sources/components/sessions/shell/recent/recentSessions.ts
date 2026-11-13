import { deriveSessionListMeaningfulActivityAt } from '@/sync/domains/session/listing/deriveSessionListActivity';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { deriveSessionRuntimePresentationStateForSession } from '@/utils/sessions/sessionUtils';

type SessionRow = Extract<SessionListViewItem, { type: 'session' }>;

/** How many sessions the 「最近」 box shows (the owner chose five, 2026-11-14). */
export const RECENT_SESSIONS_LIMIT = 5;
/** The box's collapse key among the list's collapsed groups, and its rows' group. */
export const RECENT_SESSIONS_GROUP_KEY = 'recent';

/** A session the box may show, by its list key (`<serverId>:<sessionId>`, or the id alone). */
export type RecentSessionCandidate = Readonly<{
    key: string;
    session: SessionListRenderableSession;
}>;

export function recentSessionKey(row: SessionRow): string {
    const serverId = typeof row.serverId === 'string' ? row.serverId.trim() : '';
    return serverId ? `${serverId}:${row.session.id}` : row.session.id;
}

/**
 * The sessions the 「最近」 box shows, at most `limit`: the ones running a turn or waiting for the
 * user first, then by the time each row shows (its last meaningful activity: for a terminal, when its
 * last turn ended), newest first. Stopped sessions count too; the box tells them apart by their rows.
 */
export function selectRecentSessionKeys(
    candidates: ReadonlyArray<RecentSessionCandidate>,
    nowMs: number,
    limit: number = RECENT_SESSIONS_LIMIT,
): string[] {
    const ranked = candidates.map((candidate) => {
        const runtime = deriveSessionRuntimePresentationStateForSession(candidate.session, nowMs);
        return {
            key: candidate.key,
            live: runtime.working || runtime.freshActionRequired || runtime.freshPermissionRequired,
            at: deriveSessionListMeaningfulActivityAt({
                sessionCreatedAt: candidate.session.createdAt,
                sessionMeaningfulActivityAt: candidate.session.meaningfulActivityAt ?? null,
                latestCommittedMessageCreatedAt: null,
                latestThinkingActivityAt: null,
                latestPendingMessageCreatedAt: null,
            }) ?? 0,
        };
    });
    ranked.sort((a, b) => (Number(b.live) - Number(a.live))
        || (b.at - a.at)
        || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return ranked.slice(0, Math.max(0, limit)).map((entry) => entry.key);
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
