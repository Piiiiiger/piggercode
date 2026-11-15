import { describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';

import { selectRecentSessionKeys } from './recentSessions';
import { MINUTE, recentTestRow, recentTestSession } from './recentSessions.testkit';

const NOW = 1_800_000_000_000;
const session = (id: string, fields: Partial<SessionListRenderableSession> = {}) => recentTestSession(id, NOW, fields);
/** A session the box may show, as the list holds it, with the store showing its row the same session. */
const candidate = (key: string, fields: Partial<SessionListRenderableSession> = {}) => {
    const renderable = session(key, fields);
    return { key, row: recentTestRow(renderable), state: { renderable } };
};

const finishedAt = (minutesAgo: number) => ({ meaningfulActivityAt: NOW - minutesAgo * MINUTE });
const running = { latestTurnStatus: 'in_progress' as const, latestTurnStatusObservedAt: NOW - MINUTE / 2 };
const stopped = { active: false, presence: NOW - 60 * MINUTE, activeAt: NOW - 60 * MINUTE };

describe('selectRecentSessionKeys', () => {
    it('puts running sessions and ones waiting for the user first, then the latest active, five at most', () => {
        const keys = selectRecentSessionKeys([
            candidate('old-idle', finishedAt(300)),
            candidate('just-finished', finishedAt(1)),
            candidate('long-turn', { ...finishedAt(200), ...running }),
            candidate('asks', { ...finishedAt(250), hasPendingUserActionRequests: true }),
            candidate('stopped-recently', { ...finishedAt(5), ...stopped }),
            candidate('stopped-long-ago', { ...finishedAt(5000), ...stopped }),
            candidate('idle', finishedAt(30)),
        ], NOW);

        expect(keys).toEqual(['long-turn', 'asks', 'just-finished', 'stopped-recently', 'idle']);
    });

    it('keeps a finished turn the user has not opened over newer sessions already seen, which go first', () => {
        // Turns that finished and were already looked at (their ready event is behind the read cursor).
        const seen = (minutesAgo: number) => ({ ...finishedAt(minutesAgo), seq: 4, latestReadyEventSeq: 4, lastViewedSessionSeq: 4 });
        const keys = selectRecentSessionKeys([
            candidate('seen-1', seen(1)),
            candidate('seen-2', seen(2)),
            candidate('seen-3', seen(3)),
            candidate('seen-4', seen(4)),
            candidate('seen-5', seen(5)),
            // Finished an hour ago and never opened: it still waits for the user.
            candidate('unopened', { ...finishedAt(60), seq: 7, latestReadyEventSeq: 7, lastViewedSessionSeq: 3 }),
        ], NOW);

        expect(keys).toEqual(['unopened', 'seen-1', 'seen-2', 'seen-3', 'seen-4']);
    });

    it('ranks a session by what its row shows, unread messages from the row\'s loaded transcript included', () => {
        // A chat session whose runner is gone with its turn never closed: only its loaded messages tell that a
        // reply after the last ready event is unread.
        const replied = session('replied', {
            ...finishedAt(90),
            ...stopped,
            seq: 5,
            latestReadyEventSeq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'in_progress',
            latestTurnStatusObservedAt: NOW - 120 * MINUTE,
        });
        const messages = { renderableAggregate: { messageCount: 3, latestUnreadAffectingMessageSeq: 5 } } as never;
        const seen = (key: string, minutesAgo: number) => candidate(key, { ...finishedAt(minutesAgo), seq: 2, latestReadyEventSeq: 2, lastViewedSessionSeq: 2 });
        const keys = selectRecentSessionKeys([
            seen('seen-1', 1), seen('seen-2', 2), seen('seen-3', 3), seen('seen-4', 4), seen('seen-5', 5),
            { key: 'replied', row: recentTestRow(replied), state: { renderable: replied, messages } },
        ], NOW);

        expect(keys[0]).toBe('replied');
    });

    it('no longer counts a turn as running once its runner is gone', () => {
        // The runner died mid-turn: the turn was never closed and no heartbeat came for ten minutes.
        const gone = { latestTurnStatus: 'in_progress' as const, latestTurnStatusObservedAt: NOW - 10 * MINUTE, activeAt: NOW - 10 * MINUTE, presence: NOW - 10 * MINUTE };
        const keys = selectRecentSessionKeys([
            candidate('stale', { ...finishedAt(200), ...gone }),
            candidate('recent', finishedAt(10)),
        ], NOW);

        expect(keys).toEqual(['recent', 'stale']);
    });
});
