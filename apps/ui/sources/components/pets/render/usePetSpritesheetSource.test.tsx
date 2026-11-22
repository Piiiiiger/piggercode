import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { PET_DAEMON_RPC_DEBOUNCE_LIMITS_V1 } from '@piggercode/protocol';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';
import type { SelectedPetPackageSource } from '@/components/pets/source/resolveSelectedPetPackage';

import { usePetSpritesheetSourceResult } from './usePetSpritesheetSource';

// The daemon answers preview reads over the machine RPC: the system boundary here.
const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcWithServerScopeMock,
}));

function localPet(name: string): SelectedPetPackageSource {
    return {
        kind: 'happierManagedLocal',
        sourceKey: `managed:${name}`,
        mediaType: 'image/png',
        digest: `sha256:${name}`,
        daemonTarget: { machineId: 'machine-pets', serverId: 'server-pets' },
    };
}

function previewOf(name: string, dataBase64 = 'AQID') {
    return { sourceKey: `managed:${name}`, mediaType: 'image/png', digest: `sha256:${name}`, dataBase64, sizeBytes: 3 };
}

describe('usePetSpritesheetSourceResult', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        machineRpcWithServerScopeMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        standardCleanup();
    });

    it('asks again after the daemon\'s interval when it refuses the read as rate limited', async () => {
        machineRpcWithServerScopeMock
            .mockResolvedValueOnce({ ok: false, errorCode: 'rate_limited', error: 'Pet preview is rate limited.' })
            .mockResolvedValueOnce(previewOf('busy'));

        // One object, as the memoized selection hands it over: the hook keys its load on the source object.
        const busy = localPet('busy');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(busy));
        expect(hook.getCurrent().status).toBe('loading');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(PET_DAEMON_RPC_DEBOUNCE_LIMITS_V1.readPreviewAssetMinIntervalMs);
        });
        await flushHookEffects();

        expect(hook.getCurrent()).toEqual({ source: 'data:image/png;base64,AQID', status: 'ready' });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(2);
        // All attempts share one machine RPC's budget: the second gets only what the first left.
        const [first, second] = machineRpcWithServerScopeMock.mock.calls.map(([request]) => (request as { timeoutMs: number }).timeoutMs);
        expect(second).toBeLessThan(first ?? 0);
        await hook.unmount();
    });

    it('gives up when a retried read stalls, at one machine RPC\'s budget for the whole read', async () => {
        const { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } = await import(
            '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedContext'
        );
        machineRpcWithServerScopeMock
            .mockResolvedValueOnce({ ok: false, errorCode: 'rate_limited', error: 'Pet preview is rate limited.' })
            // The transport can outlast its own timeout (an active-socket attempt, then a scoped fallback).
            .mockImplementationOnce(() => new Promise(() => undefined));
        const stalled = localPet('stalled');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(stalled));

        // The read started at the hook's first effect: it fails exactly one budget later, not a retry interval after.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS - 1);
        });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().status).toBe('loading');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        await flushHookEffects();

        expect(hook.getCurrent()).toEqual({ source: null, status: 'error' });
        await hook.unmount();
    });

    it('ends exactly at the budget while the daemon keeps refusing, also when a refusal lands just before it', async () => {
        const { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } = await import(
            '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedContext'
        );
        // Refusals take 70 ms to come back, so one lands inside the last retry interval before the budget runs out.
        machineRpcWithServerScopeMock.mockImplementation(() => new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false, errorCode: 'rate_limited', error: 'Pet preview is rate limited.' }), 70);
        }));
        const refused = localPet('refused');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(refused));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS - 1);
        });
        expect(hook.getCurrent().status).toBe('loading');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        await flushHookEffects();

        expect(hook.getCurrent()).toEqual({ source: null, status: 'error' });
        await hook.unmount();
    });

    it('keeps a loaded spritesheet, never blank, when the selection rebuilds its source object with the same content', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue(previewOf('steady'));
        const first = localPet('steady');
        const seen: Array<string | null> = [];

        const hook = await renderHook(({ source }: { source: SelectedPetPackageSource }) => {
            const result = usePetSpritesheetSourceResult(source);
            seen.push(typeof result.source === 'string' ? result.source : null);
            return result;
        }, { initialProps: { source: first } });
        await flushHookEffects();
        expect(hook.getCurrent().status).toBe('ready');
        const loadedAt = seen.length;

        await hook.rerender({ source: { ...first } });
        await flushHookEffects();

        expect(seen.slice(loadedAt)).not.toContain(null);
        expect(hook.getCurrent()).toEqual({ source: 'data:image/png;base64,AQID', status: 'ready' });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });
});
