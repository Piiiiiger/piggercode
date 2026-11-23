import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@piggercode/protocol/rpc';

const appStateEmitter = vi.hoisted(async () => {
    const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeAppStateEmitter('active');
});
const getSnapshotPlain = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<import('@piggercode/protocol').ConnectedServiceQuotaSnapshotV1 | null>>(async () => null));
const requestRefresh = vi.hoisted(() => vi.fn(async () => true));
const machineRpc = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true })));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { get OS() { return 'web'; } },
        AppState: (await appStateEmitter).appState,
    });
});
vi.mock('@/utils/platform/tauri', () => ({ isTauriDesktop: () => false }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpc,
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV2', () => ({
    getConnectedServiceQuotaSnapshotSealed: vi.fn(async () => null),
    requestConnectedServiceQuotaSnapshotRefresh: vi.fn(async () => true),
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV3', () => ({
    getConnectedServiceQuotaSnapshotPlain: getSnapshotPlain,
    requestConnectedServiceQuotaSnapshotRefreshV3: requestRefresh,
}));

import {
    __resetConnectedServiceQuotaSnapshotStore,
    buildQuotaSnapshotScopeKey,
    getQuotaSnapshotEntry,
    refreshQuotaSnapshot,
    retainQuotaSnapshotPolling,
    subscribeQuotaSnapshotEntry,
} from '@/sync/domains/connectedServices/connectedServiceQuotaSnapshotStore';

const ctx = {
    credentials: { token: 't', secret: 's' },
    credentialScope: 'scope',
    serviceId: 'openai-codex',
    profileId: 'work',
    resolveAccountMode: async () => 'plain' as const,
} as const;

describe('connectedServiceQuotaSnapshotStore polling lifecycle', () => {
    const globalWithDocument = globalThis as unknown as { document?: { visibilityState?: string } };
    const originalDocument = globalWithDocument.document;

    beforeEach(async () => {
        vi.useFakeTimers();
        globalWithDocument.document = { visibilityState: 'visible' };
        (await appStateEmitter).emit('active');
        __resetConnectedServiceQuotaSnapshotStore();
        getSnapshotPlain.mockReset();
        getSnapshotPlain.mockResolvedValue(null);
        requestRefresh.mockReset();
        requestRefresh.mockResolvedValue(true);
        machineRpc.mockReset();
        machineRpc.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        __resetConnectedServiceQuotaSnapshotStore();
        vi.useRealTimers();
        globalWithDocument.document = originalDocument;
    });


    it('preserves the public snapshot and suppresses notifications when polling release changes no visible state', async () => {
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        const snapshot = getQuotaSnapshotEntry(key);
        const onChange = vi.fn();
        const unsubscribe = subscribeQuotaSnapshotEntry(key, onChange);

        release();

        expect(getQuotaSnapshotEntry(key)).toBe(snapshot);
        expect(onChange).not.toHaveBeenCalled();
        unsubscribe();
    });

    it.each(['snapshot', 'error'] as const)('keeps accepted refresh pending beyond the old cutoff until a newer %s arrives', async (outcome) => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        void refreshQuotaSnapshot(key, ctx);
        await vi.advanceTimersByTimeAsync(11_000);
        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: true, snapshot, error: null });
        await vi.advanceTimersByTimeAsync(49_000);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(true);
        if (outcome === 'snapshot') getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });
        else getSnapshotPlain.mockRejectedValue(new Error('Quota read failed'));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(false);
        expect(getQuotaSnapshotEntry(key).snapshot?.fetchedAt).toBe(outcome === 'snapshot' ? 2 : 1);
        expect(getQuotaSnapshotEntry(key).error === null).toBe(outcome === 'snapshot');
        release();
    });


    it('retains the last snapshot when a pending refresh read temporarily has no data', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        getSnapshotPlain.mockResolvedValue(null);
        void refreshQuotaSnapshot(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        expect(getQuotaSnapshotEntry(key).snapshot).toEqual(snapshot);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(true);
        release();
    });


    it.each(['snapshot', 'error'] as const)('retries a cancelled unresolved refresh and receives a newer %s', async (outcome) => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        let finishRequest!: (accepted: boolean) => void;
        requestRefresh.mockReturnValueOnce(new Promise<boolean>((resolve) => { finishRequest = resolve; }));
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        const first = refreshQuotaSnapshot(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        release();
        const releaseAgain = retainQuotaSnapshotPolling(key, ctx);
        const retry = refreshQuotaSnapshot(key, ctx);
        const joinedRetry = refreshQuotaSnapshot(key, ctx);
        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: true, snapshot, error: null });
        expect(requestRefresh).toHaveBeenCalledTimes(1);
        finishRequest(true);
        await Promise.all([first, retry, joinedRetry]);
        expect(requestRefresh).toHaveBeenCalledTimes(2);
        expect(getSnapshotPlain).toHaveBeenCalledTimes(2);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(true);
        if (outcome === 'snapshot') getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });
        else getSnapshotPlain.mockRejectedValue(new Error('Quota read failed'));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(getQuotaSnapshotEntry(key)).toMatchObject({
            refreshing: false,
            snapshot: { fetchedAt: outcome === 'snapshot' ? 2 : 1 },
            error: outcome === 'snapshot' ? null : 'Quota read failed',
        });
        releaseAgain();
    });

    it.each(['join', 'cancel'] as const)('does not restart an unresolved refresh on %s', async (intent) => {
        let finishRequest!: (accepted: boolean) => void;
        requestRefresh.mockReturnValueOnce(new Promise<boolean>((resolve) => { finishRequest = resolve; }));
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        const first = refreshQuotaSnapshot(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        const joined = intent === 'join' ? refreshQuotaSnapshot(key, ctx) : undefined;
        if (intent === 'cancel') release();
        finishRequest(true);
        await Promise.all([first, joined]);
        expect(requestRefresh).toHaveBeenCalledTimes(1);
        expect(getSnapshotPlain).toHaveBeenCalledTimes(intent === 'join' ? 2 : 1);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(intent === 'join');
        release();
    });

    it('re-reads a meter on screen every poll, however long its numbers count as current', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });

        await vi.advanceTimersByTimeAsync(30_000);

        expect(getQuotaSnapshotEntry(key).snapshot?.fetchedAt).toBe(2);
        release();
    });

    it('notifies nobody when a background read finds the same numbers', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockImplementation(async () => ({ ...snapshot }));
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        const view = getQuotaSnapshotEntry(key);
        const onChange = vi.fn();
        const unsubscribe = subscribeQuotaSnapshotEntry(key, onChange);

        await vi.advanceTimersByTimeAsync(30_000);

        expect(getSnapshotPlain).toHaveBeenCalledTimes(2);
        expect(onChange).not.toHaveBeenCalled();
        expect(getQuotaSnapshotEntry(key)).toBe(view);
        unsubscribe();
        release();
    });

    it('shows a refresh as soon as the managing machine has read it', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        machineRpc.mockImplementationOnce(async () => {
            getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });
            return { ok: true };
        });

        await refreshQuotaSnapshot(key, ctx, { machineId: 'vm' });
        await vi.advanceTimersByTimeAsync(0);

        expect(machineRpc).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'vm',
            method: RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_REFRESH,
            payload: {},
        }));
        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: false, error: null });
        expect(getQuotaSnapshotEntry(key).snapshot?.fetchedAt).toBe(2);
        release();
    });

    it('keeps a refresh pending for the regular round when the machine cannot take it', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        machineRpc.mockRejectedValueOnce(new Error('machine offline'));

        void refreshQuotaSnapshot(key, ctx, { machineId: 'vm' });
        await vi.advanceTimersByTimeAsync(0);
        expect(machineRpc).toHaveBeenCalledTimes(1);
        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: true, error: null });

        getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });
        await vi.advanceTimersByTimeAsync(30_000);
        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: false, error: null });
        expect(getQuotaSnapshotEntry(key).snapshot?.fetchedAt).toBe(2);
        release();
    });

    it('keeps reading the relay while the machine has not answered', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        machineRpc.mockImplementationOnce(() => new Promise(() => {}));

        void refreshQuotaSnapshot(key, ctx, { machineId: 'vm' });
        await vi.advanceTimersByTimeAsync(0);
        getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });
        await vi.advanceTimersByTimeAsync(30_000);

        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: false, error: null });
        expect(getQuotaSnapshotEntry(key).snapshot?.fetchedAt).toBe(2);
        release();
    });

    it('ignores a late machine answer from an earlier press while a new press is being sent', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        let answerFirstPress: (answer: unknown) => void = () => {};
        machineRpc.mockImplementationOnce(() => new Promise((resolve) => { answerFirstPress = resolve; }));
        void refreshQuotaSnapshot(key, ctx, { machineId: 'vm' });
        await vi.advanceTimersByTimeAsync(0);
        getSnapshotPlain.mockResolvedValue({ ...snapshot, fetchedAt: 2 });
        await vi.advanceTimersByTimeAsync(30_000);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(false);

        let acceptSecondPress: (accepted: boolean) => void = () => {};
        requestRefresh.mockImplementationOnce(() => new Promise((resolve) => { acceptSecondPress = resolve; }));
        const secondPress = refreshQuotaSnapshot(key, ctx, { machineId: 'vm' });
        await vi.advanceTimersByTimeAsync(0);
        const readsBeforeLateAnswer = getSnapshotPlain.mock.calls.length;
        answerFirstPress({ ok: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(getSnapshotPlain.mock.calls.length).toBe(readsBeforeLateAnswer);

        acceptSecondPress(true);
        await secondPress;
        await vi.advanceTimersByTimeAsync(0);
        expect(machineRpc).toHaveBeenCalledTimes(2);
        release();
    });

    it('leaves a failed refresh on screen until the next regular read', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(29_000);
        requestRefresh.mockRejectedValue(new Error('refused'));

        await refreshQuotaSnapshot(key, ctx, { machineId: 'vm' });
        await vi.advanceTimersByTimeAsync(29_000);

        expect(getQuotaSnapshotEntry(key).error).toBeTruthy();
        release();
    });

    it('redraws a meter when its numbers turn old, once, even though they did not change', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: Date.now(), staleAfterMs: 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockImplementation(async () => ({ ...snapshot }));
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        const onChange = vi.fn();
        const unsubscribe = subscribeQuotaSnapshotEntry(key, onChange);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(onChange).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(onChange).toHaveBeenCalled();
        const redraws = onChange.mock.calls.length;

        await vi.advanceTimersByTimeAsync(30_000);
        expect(onChange).toHaveBeenCalledTimes(redraws);
        unsubscribe();
        release();
    });

    it('still reports loading for a read caused by opening the screen', async () => {
        const snapshot = {
            v: 1 as const, serviceId: ctx.serviceId, profileId: ctx.profileId,
            fetchedAt: 1, staleAfterMs: 30 * 60_000, planLabel: null, accountLabel: null, meters: [],
        };
        getSnapshotPlain.mockResolvedValue(snapshot);
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const firstScreen = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        firstScreen();
        await vi.advanceTimersByTimeAsync(31_000);
        let finishRead: () => void = () => {};
        getSnapshotPlain.mockImplementationOnce(() => new Promise((resolve) => { finishRead = () => resolve(snapshot); }));

        const secondScreen = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        expect(getQuotaSnapshotEntry(key).loading).toBe(true);

        finishRead();
        await vi.advanceTimersByTimeAsync(0);
        expect(getQuotaSnapshotEntry(key).loading).toBe(false);
        secondScreen();
    });

    it('cancels pending refresh polling when the last consumer leaves', async () => {
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        void refreshQuotaSnapshot(key, ctx);
        await vi.advanceTimersByTimeAsync(11_000);
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(true);
        release();
        expect(getQuotaSnapshotEntry(key).refreshing).toBe(false);
        const reads = getSnapshotPlain.mock.calls.length;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(getSnapshotPlain.mock.calls.length).toBe(reads);
    });

    it('surfaces a rejected refresh without continuing the pending state', async () => {
        const key = buildQuotaSnapshotScopeKey(ctx.credentialScope, ctx.serviceId, ctx.profileId);
        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        requestRefresh.mockRejectedValueOnce(new Error('Refresh refused'));
        void refreshQuotaSnapshot(key, ctx);
        await vi.advanceTimersByTimeAsync(11_000);
        expect(getQuotaSnapshotEntry(key)).toMatchObject({ refreshing: false, error: 'Refresh refused' });
        release();
    });


    it('stops fetching quota snapshots while the app is backgrounded and refetches on return', async () => {
        const key = buildQuotaSnapshotScopeKey('scope', 'openai-codex', 'work');

        const release = retainQuotaSnapshotPolling(key, ctx);
        await vi.advanceTimersByTimeAsync(0);
        expect(getSnapshotPlain).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(getSnapshotPlain).toHaveBeenCalledTimes(2);

        (await appStateEmitter).emit('background');
        await vi.advanceTimersByTimeAsync(30_000 * 4);
        expect(getSnapshotPlain).toHaveBeenCalledTimes(2);

        (await appStateEmitter).emit('active');
        await vi.advanceTimersByTimeAsync(0);
        expect(getSnapshotPlain).toHaveBeenCalledTimes(3);

        release();
    });
});
