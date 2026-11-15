import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A deployment identity as the relay serves it (`/.well-known/happier-ui-deployment`). */
const DEPLOYMENT = 'f6aa41f6-16bd-4815-bf49-44925e8c2df6';

afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock('react-native');
    vi.doUnmock('@/sync/api/session/apiSocket');
});

describe('the web app\'s own freshness', () => {
    it('asks the server which deployment it serves again on an explicit check, and says when it answered', async () => {
        vi.doMock('react-native', async () => {
            const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
            return createReactNativeWebMock({ Platform: { OS: 'web' } });
        });
        // The relay socket only hints at reconnects here; the deployment answer comes over HTTP.
        vi.doMock('@/sync/api/session/apiSocket', () => ({ apiSocket: { onReconnected: () => () => {} } }));
        const answers: unknown[] = [{ deploymentId: DEPLOYMENT }, {}, { deploymentId: DEPLOYMENT }];
        const fetch = vi.fn(async () => new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        // Only the clock is faked: when each answer came is what the hook reports.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_000);
        const { renderHook } = await import('@/dev/testkit');
        const { useWebUiDeploymentFreshness } = await import('./useWebUiDeploymentFreshness');

        const hook = await renderHook(() => useWebUiDeploymentFreshness());
        await vi.waitFor(() => expect(hook.getCurrent().checkedAt).toBe(1_000));

        // An answer without a usable deployment says nothing about freshness: not a check that happened.
        vi.setSystemTime(2_000);
        await act(async () => {
            await hook.getCurrent().check();
        });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().checkedAt).toBe(1_000);

        vi.setSystemTime(3_000);
        await act(async () => {
            await hook.getCurrent().check();
        });
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(hook.getCurrent().checkedAt).toBe(3_000);
        expect(hook.getCurrent().updateAvailable).toBe(false);
    });
});
