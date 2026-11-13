import React from 'react';

import { useSessionListRuntimeNowMs } from '@/hooks/session/sessionListRuntimeClock';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { storage } from '@/sync/domains/state/storage';

import { recentSessionKey, selectRecentSessionKeys, toRecentSessionRow } from './recentSessions';

type SessionRow = Extract<SessionListViewItem, { type: 'session' }>;

const NO_ROWS: SessionRow[] = [];
const NO_RENDERABLES: Readonly<Record<string, SessionRow['session'] | undefined>> = Object.freeze({});

/**
 * The rows of the 「最近」 box, out of `rows` (every session the list holds), ranked with the
 * sessions' live state: the box re-renders only when what it shows, or their order, changes. While the
 * list is not active (behind an open session on a phone, under a modal) the box keeps what it showed.
 */
export function useRecentSessionRows(rows: ReadonlyArray<SessionRow>, enabled: boolean): SessionRow[] {
    const runtimeNowMs = useSessionListRuntimeNowMs(enabled);
    const shownKeysRef = React.useRef('');
    // Store updates that leave the list's sessions alone (most of them) reuse the last ranking.
    const rankedRef = React.useRef<Readonly<{
        renderables: unknown;
        rows: ReadonlyArray<SessionRow>;
        nowMs: number;
        keys: string;
    }> | null>(null);
    const selectKeys = React.useCallback((state: Readonly<{
        sessionListRenderables?: Readonly<Record<string, SessionRow['session'] | undefined>>;
    }>): string => {
        if (!enabled) return shownKeysRef.current;
        if (rows.length === 0) return '';
        const renderables = state.sessionListRenderables ?? NO_RENDERABLES;
        const ranked = rankedRef.current;
        if (ranked && ranked.renderables === renderables && ranked.rows === rows && ranked.nowMs === runtimeNowMs) {
            return ranked.keys;
        }
        const keys = selectRecentSessionKeys(rows.map((row) => ({
            key: recentSessionKey(row),
            session: renderables[row.session.id] ?? row.session,
        })), runtimeNowMs).join('\n');
        rankedRef.current = { renderables, rows, nowMs: runtimeNowMs, keys };
        return keys;
    }, [enabled, rows, runtimeNowMs]);
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
