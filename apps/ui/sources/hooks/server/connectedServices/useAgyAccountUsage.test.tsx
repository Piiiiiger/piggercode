import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook } from '@/dev/testkit';

import { requestAgyAccountUsageRead, useAgyAccountUsage } from './useAgyAccountUsage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { machines, answers, machineRpcSpy } = vi.hoisted(() => {
    const answers: Array<(value: unknown) => void> = [];
    return {
        machines: [{ id: 'vm', active: true, activeAt: 0, metadata: { host: 'vm', platform: 'linux' } }],
        answers,
        // The machine RPC is the boundary: each read waits until the test answers it.
        machineRpcSpy: vi.fn(() => new Promise((resolve) => { answers.push(resolve); })),
    };
});

vi.mock('@/sync/store/hooks', async () => ({
    ...await vi.importActual<typeof import('@/sync/store/hooks')>('@/sync/store/hooks'),
    useAllMachines: () => machines,
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcSpy,
}));

const account = (accountId: string) => ({ accountId, email: `${accountId}@example.com`, planTier: null, observedAtMs: 1, meters: [] });

describe('useAgyAccountUsage', () => {
    afterEach(() => {
        machineRpcSpy.mockClear();
        answers.splice(0);
    });

    it('reads a machine once more when asked to while a read is out, so a removed login does not linger', async () => {
        const hook = await renderHook(() => useAgyAccountUsage());
        expect(machineRpcSpy).toHaveBeenCalledTimes(1);

        // The removal lands while the first read is out: that read may still list the login.
        requestAgyAccountUsageRead();
        await act(async () => {
            answers.shift()!({ ok: true, accounts: [account('default'), account('a')] });
            await flushHookEffects();
        });
        expect(machineRpcSpy).toHaveBeenCalledTimes(2);

        await act(async () => {
            answers.shift()!({ ok: true, accounts: [account('default')] });
            await flushHookEffects();
        });
        expect(hook.getCurrent().machines[0]?.accounts.map((entry) => entry.accountId)).toEqual(['default']);
        // Asked once: no further read until the page's next turn.
        expect(machineRpcSpy).toHaveBeenCalledTimes(2);
        await hook.unmount();
    });
});
