import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { clearActiveViewingSessionsForServerScopeReset } from '@/sync/domains/session/activeViewingSession';
import { resetSessionManualUnreadHoldsForTests } from '@/sync/domains/session/readState/sessionManualUnreadHold';
import { getStorage } from '@/sync/domains/state/storageStore';

import { SessionSurfaceViewedLifecycle } from './SessionSurfaceViewedLifecycle';

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (effect: () => void | (() => void)) => {
        React.useEffect(() => {
            const cleanup = effect();
            return () => {
                cleanup?.();
            };
        }, [effect]);
    },
}));

function terminalSession(seq: number) {
    return {
        id: 'terminal-session',
        seq,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 'online' as const,
    };
}

describe('SessionSurfaceViewedLifecycle', () => {
    let previousState: ReturnType<ReturnType<typeof getStorage>['getState']>;

    beforeEach(() => {
        vi.useFakeTimers();
        resetSessionManualUnreadHoldsForTests();
        clearActiveViewingSessionsForServerScopeReset();
        previousState = getStorage().getState();
    });

    afterEach(() => {
        standardCleanup();
        vi.restoreAllMocks();
        clearActiveViewingSessionsForServerScopeReset();
        getStorage().setState(previousState, true);
        vi.useRealTimers();
    });

    it('marks an open session viewed when its turn finishes, also when only its list row learned the new seq', async () => {
        const { sync } = await import('@/sync/sync');
        const markSessionViewed = vi.spyOn(sync, 'markSessionViewed').mockResolvedValue(undefined);
        const store = getStorage();
        act(() => store.getState().applySessions([terminalSession(83)]));
        expect(store.getState().sessionListRenderables['terminal-session']?.seq).toBe(83);

        await renderScreen(<SessionSurfaceViewedLifecycle sessionId="terminal-session" serverId={null} surfaceFocused />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });
        markSessionViewed.mockClear();

        // A session with no transcript on screen (every session shows its terminal) takes realtime message updates as
        // list-row patches only (socket.ts, applySessionListRenderablePatches): the turn's ready event moves the row
        // that says 「待查阅」, not the session record.
        act(() => store.getState().applySessionListRenderablePatches([
            { sessionId: 'terminal-session', patch: { seq: 84 } },
        ]));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });

        expect(markSessionViewed).toHaveBeenCalledWith('terminal-session', { sessionSeq: 84 });
    });
});
