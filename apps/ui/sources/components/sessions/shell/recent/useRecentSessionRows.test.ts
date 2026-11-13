import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';

import { MINUTE, recentTestRow, recentTestSession } from './recentSessions.testkit';
import { useRecentSessionRows } from './useRecentSessionRows';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
    await standardCleanup();
    storage.setState({ sessionListRenderables: {} } as never);
});

describe('useRecentSessionRows', () => {
    it('moves a session up as soon as it starts working, without the list being rebuilt', async () => {
        const now = Date.now();
        const quiet = recentTestSession('quiet', now, { meaningfulActivityAt: now - 2 * MINUTE });
        const later = recentTestSession('later', now, { meaningfulActivityAt: now - 90 * MINUTE });
        // The list's rows were built before `later` started its turn and are not rebuilt.
        const rows = [recentTestRow(quiet), recentTestRow(later)];
        storage.setState({ sessionListRenderables: { quiet, later } } as never);

        const hook = await renderHook(() => useRecentSessionRows(rows, true));
        expect(hook.getCurrent().map((row) => row.session.id)).toEqual(['quiet', 'later']);

        await act(async () => {
            storage.setState({
                sessionListRenderables: {
                    quiet,
                    later: { ...later, latestTurnStatus: 'in_progress', latestTurnStatusObservedAt: Date.now() },
                },
            } as never);
        });

        expect(hook.getCurrent().map((row) => row.session.id)).toEqual(['later', 'quiet']);
        // Each is shown as a flat row of the box, wherever its folder is.
        expect(hook.getCurrent()[1]).toMatchObject({ groupKey: 'recent', groupKind: 'recent', folderDepth: 0, session: quiet });
    });
});
