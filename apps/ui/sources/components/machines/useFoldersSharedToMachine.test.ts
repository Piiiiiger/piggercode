import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import type { Machine } from '@/sync/domains/state/storageTypes';

const fleet = vi.hoisted(() => ({ active: [] as Machine[], byServer: {} as Record<string, Machine[] | null> }));
const rpc = vi.hoisted(() => ({
    calls: [] as Array<Readonly<{ machineId: string; serverId: string | null | undefined }>>,
    answers: new Map<string, unknown>(),
    pending: new Set<string>(),
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({
        importOriginal,
        overrides: { useAllMachines: () => fleet.active, useMachineListByServerId: () => fleet.byServer },
    });
});

vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>(),
    getActiveServerSnapshot: () => ({ serverId: 'relay-a', serverUrl: 'https://relay-a.example.test', generation: 0 }),
    subscribeActiveServer: () => () => {},
}));

// The machine RPC is the boundary: each computer answers `daemon.folderShare.list` for its own shares.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc')>(),
    machineRpcWithServerScope: vi.fn(async (params: Readonly<{ machineId: string; serverId?: string | null }>) => {
        rpc.calls.push({ machineId: params.machineId, serverId: params.serverId });
        if (rpc.pending.has(params.machineId)) return await new Promise(() => {});
        const answer = rpc.answers.get(params.machineId);
        if (answer === undefined) throw new Error('The machine cannot take this call');
        return answer;
    }),
}));

import { useFoldersSharedToMachine } from './useFoldersSharedToMachine';

function online(id: string, host: string): Machine {
    const machine = createMachineFixture({ id, active: true, activeAt: Date.now() });
    return { ...machine, metadata: { ...machine.metadata!, host, displayName: host } };
}

const MAC_SHARES = {
    shares: [
        { folder: 'code', serverMachineId: 'server', serverPath: '~/local/macbook-air/code', state: 'connected' },
        { folder: 'notes', serverMachineId: 'server', serverPath: '~/local/macbook-air/notes', state: 'retrying', error: 'offline' },
        { folder: 'photos', serverMachineId: 'elsewhere', serverPath: '~/local/macbook-air/photos', state: 'connected' },
    ],
};

function reset() {
    rpc.calls.length = 0;
    rpc.answers.clear();
    rpc.pending.clear();
}

describe('the folders shared with a machine', () => {
    it('lists the mounted folders the other computers share with it, by computer and folder', async () => {
        reset();
        fleet.active = [online('server', 'pigger'), online('mac', 'MacBook-Air'), online('laptop', 'laptop')];
        rpc.answers.set('mac', MAC_SHARES);
        // The laptop cannot answer (an older PiggerCode, or it just went offline): it adds nothing.

        const hook = await renderHook(() => useFoldersSharedToMachine('server', null));
        await vi.waitFor(() => expect(hook.getCurrent()).toHaveLength(1));

        expect(hook.getCurrent()).toEqual([{ path: '~/local/macbook-air/code', computerName: 'MacBook-Air', folder: 'code' }]);
        // The machine itself is never asked about its own shares.
        expect(rpc.calls.map((call) => call.machineId).sort()).toEqual(['laptop', 'mac']);
    });

    it('shows a computer\'s folders as soon as it answers, while another is still being asked', async () => {
        reset();
        fleet.active = [online('server', 'pigger'), online('laptop', 'laptop'), online('mac', 'MacBook-Air')];
        rpc.pending.add('laptop');
        rpc.answers.set('mac', MAC_SHARES);

        const hook = await renderHook(() => useFoldersSharedToMachine('server', null));

        await vi.waitFor(() => expect(hook.getCurrent()).toEqual([
            { path: '~/local/macbook-air/code', computerName: 'MacBook-Air', folder: 'code' },
        ]));
    });

    it('asks the computers of the relay the picker targets, through that relay', async () => {
        reset();
        fleet.active = [online('other-server', 'elsewhere'), online('other-mac', 'Other')];
        fleet.byServer = { 'relay-b': [online('server', 'pigger'), online('mac', 'MacBook-Air')] };
        rpc.answers.set('mac', MAC_SHARES);

        const hook = await renderHook(() => useFoldersSharedToMachine('server', 'relay-b'));
        await vi.waitFor(() => expect(hook.getCurrent()).toHaveLength(1));

        expect(rpc.calls).toEqual([{ machineId: 'mac', serverId: 'relay-b' }]);
    });
});
