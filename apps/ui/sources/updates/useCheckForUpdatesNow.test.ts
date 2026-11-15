import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import type { Machine } from '@/sync/domains/state/storageTypes';

const rpc = vi.hoisted(() => ({
    detect: vi.fn(async (..._args: unknown[]) => ({ supported: true, response: { protocolVersion: 1, results: {} } })),
}));
const fleet = vi.hoisted(() => ({ machines: [] as Machine[] }));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

// The machine RPC is the boundary: each machine answers its update facts through the capability detect.
vi.mock('@/sync/ops', () => ({
    machineCapabilitiesDetect: (...args: unknown[]) => rpc.detect(...args),
    machineCapabilitiesInvoke: vi.fn(),
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({ importOriginal, overrides: { useAllMachines: () => fleet.machines } });
});

vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>(),
    getActiveServerSnapshot: () => ({ serverId: 'srv', serverUrl: 'https://relay.example.test', generation: 0 }),
    subscribeActiveServer: () => () => {},
}));

import { useUpdateCheckInFlight } from './updateCheckInFlight';
import { useCheckForUpdatesNow } from './useCheckForUpdatesNow';

describe('Check for updates', () => {
    it('checks this app and has every online machine look again with its caches bypassed', async () => {
        fleet.machines = [
            createMachineFixture({ id: 'server-vm', active: true, activeAt: Date.now() }),
            createMachineFixture({ id: 'old-laptop', active: false, activeAt: 0 }),
        ];
        const checkApp = vi.fn(async () => {});
        const hook = await renderHook(() => useCheckForUpdatesNow(checkApp));

        await act(async () => {
            await hook.getCurrent()();
        });

        expect(checkApp).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(rpc.detect).toHaveBeenCalled());
        expect(rpc.detect.mock.calls.map((call) => call[0])).toEqual(['server-vm']);
        const request = rpc.detect.mock.calls[0]?.[1] as { bypassCache?: boolean; requests?: Array<{ id: string }> };
        expect(request.bypassCache).toBe(true);
        // The machine's own CLI version check answers through `tool.systemTasks`.
        expect(request.requests?.map((entry) => entry.id)).toContain('tool.systemTasks');
    });

    it('tells every surface a check is running until it settles, a failed one too', async () => {
        fleet.machines = [];
        const settle: Array<(error?: Error) => void> = [];
        const checkApp = vi.fn(() => new Promise<void>((resolve, reject) => {
            settle.push((error) => (error ? reject(error) : resolve()));
        }));
        const pressed = await renderHook(() => ({ checkNow: useCheckForUpdatesNow(checkApp), checking: useUpdateCheckInFlight() }));
        const elsewhere = await renderHook(() => useUpdateCheckInFlight());
        expect([pressed.getCurrent().checking, elsewhere.getCurrent()]).toEqual([false, false]);

        let run: Promise<void> = Promise.resolve();
        await act(async () => {
            run = pressed.getCurrent().checkNow();
        });
        expect([pressed.getCurrent().checking, elsewhere.getCurrent()]).toEqual([true, true]);
        await act(async () => {
            settle[0]?.();
            await run;
        });
        expect([pressed.getCurrent().checking, elsewhere.getCurrent()]).toEqual([false, false]);

        await act(async () => {
            run = pressed.getCurrent().checkNow().catch(() => {});
        });
        expect(elsewhere.getCurrent()).toBe(true);
        await act(async () => {
            settle[1]?.(new Error('offline'));
            await run;
        });
        expect(elsewhere.getCurrent()).toBe(false);
    });
});
