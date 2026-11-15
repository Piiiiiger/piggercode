import React from 'react';

import { useSessionListRuntimeNowMs } from '@/hooks/session/sessionListRuntimeClock';
import type { SessionListBackgroundWorkAttentionMode } from '@/sync/domains/session/listing/sessionListBackgroundWorkAttention';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { storage } from '@/sync/domains/state/storage';
import { selectSessionListRowStateSnapshot } from '@/sync/store/sessionListRowStateSnapshot';

import type { SessionListRowStateSnapshot, SessionListRowStoreState } from '../row/sessionListRowModelTypes';
import {
    orderRecentSessionKeys,
    rankRecentSessionCandidate,
    recentSessionKey,
    toRecentSessionRow,
    type RecentSessionRank,
} from './recentSessions';

type SessionRow = Extract<SessionListViewItem, { type: 'session' }>;

const NO_ROWS: SessionRow[] = [];

/** A session's last rank, with what it was computed from: the rank holds while none of them changed. */
type RankedCandidate = Readonly<{
    row: SessionRow;
    snapshot: SessionListRowStateSnapshot;
    nowMs: number;
    backgroundWorkAttentionMode: SessionListBackgroundWorkAttentionMode | undefined;
    rank: RecentSessionRank;
}>;

function sameSnapshot(a: SessionListRowStateSnapshot, b: SessionListRowStateSnapshot): boolean {
    return a.session === b.session && a.renderable === b.renderable && a.messages === b.messages && a.pending === b.pending;
}

/**
 * The rows of the 「最近」 box, out of `rows` (every session the list holds), ranked with what their rows
 * show: each session's row store snapshot, the same the row reads (`backgroundWorkAttentionMode` is the
 * rows' setting). A store change re-ranks only the sessions whose row inputs changed, and the box
 * re-renders only when what it shows, or their order, changes. While the list is not active (behind an
 * open session on a phone, under a modal) the box keeps what it showed.
 */
export function useRecentSessionRows(
    rows: ReadonlyArray<SessionRow>,
    enabled: boolean,
    backgroundWorkAttentionMode?: SessionListBackgroundWorkAttentionMode,
): SessionRow[] {
    const runtimeNowMs = useSessionListRuntimeNowMs(enabled);
    const shownKeysRef = React.useRef('');
    // The last ranking: each session's rank and the keys they ordered to, read again when nothing changed.
    const rankedRef = React.useRef<Readonly<{ candidates: ReadonlyMap<string, RankedCandidate>; keys: string }>>({
        candidates: new Map(),
        keys: '',
    });
    const selectKeys = React.useCallback((state: SessionListRowStoreState): string => {
        if (!enabled) return shownKeysRef.current;
        if (rows.length === 0) return '';
        const previous = rankedRef.current.candidates;
        const next = new Map<string, RankedCandidate>();
        let changed = previous.size !== rows.length;
        for (const row of rows) {
            const key = recentSessionKey(row);
            const snapshot = selectSessionListRowStateSnapshot(state, { sessionId: row.session.id, serverId: row.serverId });
            const last = previous.get(key);
            if (
                last
                && last.row === row
                && last.nowMs === runtimeNowMs
                && last.backgroundWorkAttentionMode === backgroundWorkAttentionMode
                && sameSnapshot(last.snapshot, snapshot)
            ) {
                next.set(key, last);
                continue;
            }
            const rank = rankRecentSessionCandidate({ key, row, state: snapshot }, runtimeNowMs, backgroundWorkAttentionMode);
            changed = changed || !last || last.rank.tellsUser !== rank.tellsUser || last.rank.at !== rank.at;
            next.set(key, { row, snapshot, nowMs: runtimeNowMs, backgroundWorkAttentionMode, rank });
        }
        const keys = changed
            ? orderRecentSessionKeys(Array.from(next.values(), (entry) => entry.rank)).join('\n')
            : rankedRef.current.keys;
        rankedRef.current = { candidates: next, keys };
        return keys;
    }, [backgroundWorkAttentionMode, enabled, rows, runtimeNowMs]);
    const keys = storage(selectKeys);
    shownKeysRef.current = keys;
    return React.useMemo(() => {
        if (!keys) return NO_ROWS;
        const byKey = new Map(rows.map((row) => [recentSessionKey(row), row] as const));
        const shown: SessionRow[] = [];
        for (const key of keys.split('\n')) {
            const row = byKey.get(key);
            if (row) shown.push(toRecentSessionRow(row));
        }
        return shown;
    }, [keys, rows]);
}
