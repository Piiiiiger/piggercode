import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMachineFixture } from '@/dev/testkit';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { AccountSettingsChangedError, type AccountSettingExclusiveUpdate } from '@/sync/engine/settings/syncSettings';

// Boundaries: the relay's account profile (HTTP), the signed-in session, and the sync engine's one-shot
// settings update and machine read, simulated over one server-side settings value (the engine's own tests
// cover reading, opening and compare-and-set).
const boundary = vi.hoisted(() => ({
    serverFetch: vi.fn(),
    credentials: { token: 't', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } as unknown,
    server: { management: undefined as unknown, changedBeforeWrite: undefined as unknown, readFails: false, writes: [] as unknown[] },
    machines: [] as unknown[],
}));

vi.mock('@/sync/http/client', () => ({ serverFetch: boundary.serverFetch }));
vi.mock('@/auth/context/AuthContext', () => ({
    getCurrentAuth: () => (boundary.credentials ? { credentials: boundary.credentials } : null),
}));
vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({
        updateAccountSettingOnce: async (update: AccountSettingExclusiveUpdate) => {
            if (boundary.server.readFails) throw new Error('settings could not be read');
            const next = await update.decide(boundary.server.management);
            if (next === undefined) return;
            if (boundary.server.changedBeforeWrite !== undefined) {
                boundary.server.management = boundary.server.changedBeforeWrite;
                throw new AccountSettingsChangedError();
            }
            boundary.server.management = next;
            boundary.server.writes.push(next);
        },
        readMachinesOrThrow: async () => boundary.machines,
    }),
}));

import { changeManagingMachine, setConnectedServicePoolsPaused } from './connectedServicesManagementCommands';

const machine = (id: string, version: string): Machine => createMachineFixture({
    id,
    metadata: { host: id, platform: 'linux', happyCliVersion: version, happyHomeDir: '/h', homeDir: '/h' },
});

function serveAccountProfile(codexProfileIds: readonly string[] | 'unreadable'): void {
    boundary.serverFetch.mockImplementation(async (path: string) => {
        if (path !== '/v1/account/profile') throw new Error(`Unexpected request: ${path}`);
        if (codexProfileIds === 'unreadable') return Response.json({ id: 42 });
        return Response.json({
            id: 'account-1', timestamp: 0, firstName: null, lastName: null, username: null, avatar: null,
            linkedProviders: [], connectedServices: [],
            connectedServicesV2: [{
                serviceId: 'openai-codex',
                profiles: codexProfileIds.map((profileId) => ({ profileId, status: 'connected', kind: 'oauth', providerAccountId: `acct-${profileId}` })),
                groups: [],
            }],
        });
    });
}

beforeEach(() => {
    boundary.serverFetch.mockReset();
    boundary.credentials = { token: 't', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    boundary.server = { management: undefined, changedBeforeWrite: undefined, readFails: false, writes: [] };
    boundary.machines = [machine('vm', '0.3.42'), machine('mac', '0.3.42')];
    serveAccountProfile([]);
});

describe('changeManagingMachine', () => {
    it('chooses a machine while no subscription account is connected', async () => {
        await expect(changeManagingMachine('vm')).resolves.toEqual({ ok: true });
        expect(boundary.server.writes).toEqual([{ v: 1, managingMachineId: 'vm', poolsPaused: false }]);
    });

    it('refuses to move the manager while the server lists a connected subscription account', async () => {
        boundary.server.management = { v: 1, managingMachineId: 'vm', poolsPaused: false };
        serveAccountProfile(['work']);
        await expect(changeManagingMachine('mac')).resolves.toEqual({ ok: false, reason: 'enrolled_profiles' });
        expect(boundary.server.writes).toEqual([]);
    });

    it('changes nothing when the account list cannot be read as one', async () => {
        boundary.server.management = { v: 1, managingMachineId: 'vm', poolsPaused: false };
        serveAccountProfile('unreadable');
        await expect(changeManagingMachine('mac')).resolves.toEqual({ ok: false, reason: 'unconfirmed' });
        expect(boundary.server.writes).toEqual([]);
    });

    it('changes nothing when another client changed the setting before the write', async () => {
        const otherClientsChoice = { v: 1, managingMachineId: 'mac', poolsPaused: false };
        boundary.server.changedBeforeWrite = otherClientsChoice;
        await expect(changeManagingMachine('vm')).resolves.toEqual({ ok: false, reason: 'unconfirmed' });
        expect(boundary.server.management).toEqual(otherClientsChoice);
    });

    it('changes nothing when signed out', async () => {
        boundary.credentials = null;
        await expect(changeManagingMachine('vm')).resolves.toEqual({ ok: false, reason: 'unconfirmed' });
        expect(boundary.server.writes).toEqual([]);
    });
});

describe('setConnectedServicePoolsPaused', () => {
    it('keeps the managing machine the server has now', async () => {
        boundary.server.management = { v: 1, managingMachineId: 'vm', poolsPaused: false };
        await expect(setConnectedServicePoolsPaused(true)).resolves.toEqual({ ok: true });
        expect(boundary.server.writes).toEqual([{ v: 1, managingMachineId: 'vm', poolsPaused: true }]);
    });

    it('resumes pools only while every machine the server lists honours the setting; pausing is always allowed', async () => {
        boundary.server.management = { v: 1, managingMachineId: 'vm', poolsPaused: true };
        boundary.machines = [machine('vm', '0.3.42'), machine('mac', '0.3.41')];
        await expect(setConnectedServicePoolsPaused(false)).resolves.toMatchObject({ ok: false, reason: 'incompatible_machines' });
        expect(boundary.server.writes).toEqual([]);

        boundary.server.management = { v: 1, managingMachineId: 'vm', poolsPaused: false };
        await expect(setConnectedServicePoolsPaused(true)).resolves.toEqual({ ok: true });
        expect(boundary.server.writes).toEqual([{ v: 1, managingMachineId: 'vm', poolsPaused: true }]);
    });

    it('changes nothing when the settings cannot be read', async () => {
        boundary.server.readFails = true;
        await expect(setConnectedServicePoolsPaused(true)).resolves.toEqual({ ok: false, reason: 'unconfirmed' });
        expect(boundary.server.writes).toEqual([]);
    });
});
