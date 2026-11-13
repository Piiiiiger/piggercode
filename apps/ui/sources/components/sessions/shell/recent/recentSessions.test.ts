import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';

import { selectRecentSessionKeys } from './recentSessions';
import { MINUTE, recentTestSession } from './recentSessions.testkit';

const NOW = 1_800_000_000_000;
const session = (id: string, fields: Partial<SessionListRenderableSession> = {}) => recentTestSession(id, NOW, fields);

const finishedAt = (minutesAgo: number) => ({ meaningfulActivityAt: NOW - minutesAgo * MINUTE });
const running = { latestTurnStatus: 'in_progress' as const, latestTurnStatusObservedAt: NOW - MINUTE / 2 };
const stopped = { active: false, presence: NOW - 60 * MINUTE, activeAt: NOW - 60 * MINUTE };

describe('selectRecentSessionKeys', () => {
    it('puts running sessions and ones waiting for the user first, then the latest active, five at most', () => {
        const keys = selectRecentSessionKeys([
            { key: 'old-idle', session: session('old-idle', finishedAt(300)) },
            { key: 'just-finished', session: session('just-finished', finishedAt(1)) },
            { key: 'long-turn', session: session('long-turn', { ...finishedAt(200), ...running }) },
            { key: 'asks', session: session('asks', { ...finishedAt(250), hasPendingUserActionRequests: true }) },
            { key: 'stopped-recently', session: session('stopped-recently', { ...finishedAt(5), ...stopped }) },
            { key: 'stopped-long-ago', session: session('stopped-long-ago', { ...finishedAt(5000), ...stopped }) },
            { key: 'idle', session: session('idle', finishedAt(30)) },
        ], NOW);

        expect(keys).toEqual(['long-turn', 'asks', 'just-finished', 'stopped-recently', 'idle']);
    });

    it('no longer counts a turn as running once its runner is gone', () => {
        // The runner died mid-turn: the turn was never closed and no heartbeat came for ten minutes.
        const gone = { latestTurnStatus: 'in_progress' as const, latestTurnStatusObservedAt: NOW - 10 * MINUTE, activeAt: NOW - 10 * MINUTE, presence: NOW - 10 * MINUTE };
        const keys = selectRecentSessionKeys([
            { key: 'stale', session: session('stale', { ...finishedAt(200), ...gone }) },
            { key: 'recent', session: session('recent', finishedAt(10)) },
        ], NOW);

        expect(keys).toEqual(['recent', 'stale']);
    });
});
