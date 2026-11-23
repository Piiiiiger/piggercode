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

    it('gives a retried attempt only what is left of the budget, and fails when the transport gives up', async () => {
        const { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } = await import(
            '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedContext'
        );
        machineRpcWithServerScopeMock
            .mockResolvedValueOnce({ ok: false, errorCode: 'rate_limited', error: 'Pet preview is rate limited.' })
            // The transport bounds its own wait: this attempt rejects when the time it was given runs out.
            .mockImplementationOnce(({ timeoutMs }: { timeoutMs: number }) => new Promise((_resolve, reject) => {
                setTimeout(() => reject(new Error('Machine RPC timed out')), timeoutMs);
            }));
        const stalled = localPet('stalled');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(stalled));

        // The read started at the hook's first effect: it fails one budget later, not a retry interval after.
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

    it('counts a daemon that keeps refusing for the whole budget as no answer', async () => {
        const { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } = await import(
            '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedContext'
        );
        machineRpcWithServerScopeMock.mockImplementation(() => new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false, errorCode: 'rate_limited', error: 'Pet preview is rate limited.' }), 70);
        }));
        const refused = localPet('refused');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(refused));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS - 1);
        });
        expect(hook.getCurrent().status).toBe('loading');

        // The refusal in flight and its wait finish, then the read sees the budget is spent.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(70 + PET_DAEMON_RPC_DEBOUNCE_LIMITS_V1.readPreviewAssetMinIntervalMs);
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

    it('keeps its one read going when the selection rebuilds its source object meanwhile', async () => {
        let answer: (value: unknown) => void = () => undefined;
        machineRpcWithServerScopeMock.mockImplementationOnce(() => new Promise((resolve) => {
            answer = resolve;
        }));
        const first = localPet('rebuilt');
        const hook = await renderHook(
            ({ source }: { source: SelectedPetPackageSource }) => usePetSpritesheetSourceResult(source),
            { initialProps: { source: first } },
        );
        await flushHookEffects();

        await hook.rerender({ source: { ...first } });
        await flushHookEffects();
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            answer(previewOf('rebuilt'));
        });
        await flushHookEffects();

        expect(hook.getCurrent()).toEqual({ source: 'data:image/png;base64,AQID', status: 'ready' });
        await hook.unmount();
    });

    it('comes back by itself after a read that got no answer, without asking again at once', async () => {
        // The daemon's connection drops while it answers: the read fails, and the daemon is back a while later.
        machineRpcWithServerScopeMock
            .mockRejectedValueOnce(new Error('Machine RPC timed out'))
            .mockResolvedValueOnce(previewOf('dropped'));
        const dropped = localPet('dropped');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(dropped));
        await flushHookEffects();
        expect(hook.getCurrent()).toEqual({ source: null, status: 'error' });

        // An answer can be a couple of MB, on a link that has just failed: the next read waits.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_999);
        });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(2 * 60_000);
        });
        await flushHookEffects();

        expect(hook.getCurrent()).toEqual({ source: 'data:image/png;base64,AQID', status: 'ready' });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(2);
        await hook.unmount();
    });

    it('does not ask again while an earlier read is still in the transport', async () => {
        // The transport can run past the read's budget (an active-socket attempt, then a scoped fallback).
        let giveUp: (error: Error) => void = () => undefined;
        machineRpcWithServerScopeMock
            .mockImplementationOnce(() => new Promise((_resolve, reject) => {
                giveUp = reject;
            }))
            .mockResolvedValueOnce(previewOf('overlap'));
        const overlap = localPet('overlap');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(overlap));
        await flushHookEffects();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5 * 60_000);
        });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            giveUp(new Error('Machine RPC timed out'));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2 * 60_000);
        });
        await flushHookEffects();

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent()).toEqual({ source: 'data:image/png;base64,AQID', status: 'ready' });
        await hook.unmount();
    });

    it('does not ask again once the daemon has answered that it cannot serve this pet', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue({
            ok: false,
            errorCode: 'not_found',
            error: 'Pet package source was not found.',
        });
        const gone = localPet('gone');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(gone));
        await flushHookEffects();
        expect(hook.getCurrent()).toEqual({ source: null, status: 'error' });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10 * 60_000);
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });

    it('stops asking when the surface showing the pet goes away', async () => {
        machineRpcWithServerScopeMock.mockRejectedValue(new Error('Machine RPC timed out'));
        const leaving = localPet('leaving');
        const hook = await renderHook(() => usePetSpritesheetSourceResult(leaving));
        await flushHookEffects();
        await hook.unmount();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(10 * 60_000);
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
    });
});
