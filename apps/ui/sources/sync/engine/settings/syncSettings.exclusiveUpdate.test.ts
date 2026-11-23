import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { invalidateAccountEncryptionModeCache } from '@/sync/api/account/apiAccountEncryptionMode';
import { settingsDefaults, type Settings } from '@/sync/domains/settings/settings';
import { storage } from '@/sync/domains/state/storage';
import { loadPendingSettings, savePendingSettings } from '@/sync/domains/state/persistence';
import { createAccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import { AccountSettingsChangedError, syncSettings } from './syncSettings';

const boundary = vi.hoisted(() => ({ serverFetch: vi.fn(), serverUrl: 'https://relay-a.example.test', serverId: 'server-a' }));
vi.mock('@/sync/http/client', () => ({ serverFetch: boundary.serverFetch }));
// The active relay, as the server runtime reports it (switching it is what the user does in the app).
vi.mock('@/sync/domains/server/serverRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverRuntime')>();
    return {
        ...actual,
        getActiveServerSnapshot: () => ({ ...actual.getActiveServerSnapshot(), serverUrl: boundary.serverUrl, serverId: boundary.serverId }),
    };
});

describe('syncSettings: the managing-machine setting is updated once, never queued', () => {
    const credentials = { token: 'plain-token' };
    const initialState = storage.getState();
    const managedByVm = { v: 1, managingMachineId: 'vm', poolsPaused: false } as const;

    beforeEach(() => {
        invalidateAccountEncryptionModeCache();
        boundary.serverFetch.mockReset();
        boundary.serverUrl = 'https://relay-a.example.test';
        boundary.serverId = 'server-a';
        storage.setState({ settings: { ...settingsDefaults }, settingsVersion: 0 });
        savePendingSettings({});
    });

    afterEach(() => {
        storage.setState(initialState, true);
    });

    function serve(params: Readonly<{ content: unknown; mode?: 'plain' | 'e2ee'; postAnswer?: unknown }>) {
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit) => {
            if (path === '/v1/account/encryption') return Response.json({ mode: params.mode ?? 'plain', updatedAt: 1 });
            if (path === '/v2/account/settings' && init?.method === 'POST') {
                return Response.json(params.postAnswer ?? { success: true, version: 5 });
            }
            if (path === '/v2/account/settings') return Response.json({ content: params.content, version: 4 });
            throw new Error(`Unexpected request: ${path}`);
        });
    }

    function posts(): unknown[] {
        return boundary.serverFetch.mock.calls
            .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
            .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    }

    it('decides on the value read from the server and writes only that key, once, against the version read', async () => {
        serve({ content: { t: 'plain', v: { analyticsOptOut: true, connectedServicesManagementV1: managedByVm } } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const decide = vi.fn((current: unknown) => ({ ...(current as typeof managedByVm), poolsPaused: true }));

        await syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide },
        });

        expect(decide).toHaveBeenCalledWith(managedByVm);
        expect(posts()).toEqual([{
            content: { t: 'plain', v: { analyticsOptOut: true, connectedServicesManagementV1: { ...managedByVm, poolsPaused: true } } },
            expectedVersion: 4,
        }]);
        expect(storage.getState().settings.connectedServicesManagementV1).toEqual({ ...managedByVm, poolsPaused: true });
        expect(storage.getState().settingsVersion).toBe(5);
    });

    it('fails without a second attempt when the settings changed before the write', async () => {
        serve({
            content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } },
            postAnswer: { success: false, error: 'version-mismatch', currentVersion: 5, currentContent: null },
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);

        await expect(syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: () => ({ ...managedByVm, managingMachineId: 'mac' }) },
        })).rejects.toBeInstanceOf(AccountSettingsChangedError);
        expect(posts()).toHaveLength(1);
    });

    it('decides nothing on settings it cannot open', async () => {
        serve({ content: { t: 'encrypted', c: 'ciphertext' }, mode: 'e2ee' });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const decide = vi.fn(() => managedByVm);

        await expect(syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide },
        })).rejects.toThrow();
        expect(decide).not.toHaveBeenCalled();
        expect(posts()).toHaveLength(0);
    });

    it('drops a queued value of the setting instead of writing it later over a newer one', async () => {
        serve({ content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        // Queued by a client that went offline before it was written; the server has a newer manager since.
        const pendingSettings = {
            analyticsOptOut: true,
            connectedServicesManagementV1: { v: 1, managingMachineId: 'old-mac', poolsPaused: true },
        } as Partial<Settings>;
        savePendingSettings(pendingSettings);

        await syncSettings({ credentials, encryption, pendingSettings, clearPendingSettings: vi.fn(savePendingSettings) });

        expect(posts()).toEqual([{
            content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm, analyticsOptOut: true } },
            expectedVersion: 4,
        }]);
        expect(loadPendingSettings()).toEqual({});
        expect(storage.getState().settings.connectedServicesManagementV1).toEqual(managedByVm);
    });

    it('keeps queued edits of other settings, persisted or not, on top of the server copy', async () => {
        serve({ content: { t: 'plain', v: { analyticsOptOut: false, connectedServicesManagementV1: managedByVm } } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        savePendingSettings({}); // the edit below is still in memory, waiting for its debounced save
        const clearPendingSettings = vi.fn(savePendingSettings);

        await syncSettings({
            credentials, encryption, pendingSettings: { analyticsOptOut: true }, clearPendingSettings,
            readPendingSettings: () => ({ persisted: {}, live: { analyticsOptOut: true } }),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: (current) => ({ ...(current as typeof managedByVm), poolsPaused: true }) },
        });

        expect(storage.getState().settings.analyticsOptOut).toBe(true);
        expect(clearPendingSettings).not.toHaveBeenCalled();
    });

    it('writes every other stored key back exactly as read, including ones a migration still needs', async () => {
        const legacyFolders = [{ id: 'folder-1', name: 'Kept until imported' }];
        serve({ content: { t: 'plain', v: { sessionFoldersV1: legacyFolders, connectedServicesManagementV1: managedByVm } } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);

        await syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: (current) => ({ ...(current as typeof managedByVm), poolsPaused: true }) },
        });

        expect(posts()).toEqual([{
            content: { t: 'plain', v: { sessionFoldersV1: legacyFolders, connectedServicesManagementV1: { ...managedByVm, poolsPaused: true } } },
            expectedVersion: 4,
        }]);
    });

    it('tries each request once, and a write lost on the network changes nothing locally', async () => {
        serve({ content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } } });
        const answer = boundary.serverFetch.getMockImplementation()!;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            if (path === '/v2/account/settings' && init?.method === 'POST') throw new TypeError('Network request failed');
            return await answer(path, init, options);
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);

        await expect(syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: () => ({ ...managedByVm, managingMachineId: 'mac' }) },
        })).rejects.toThrow('Network request failed');

        // The settings read and the write are each tried once (the mode read before the decision only waits
        // for reachability within its own bound).
        const settingsRequests = boundary.serverFetch.mock.calls.filter(([path]) => path === '/v2/account/settings');
        expect(settingsRequests).toHaveLength(2);
        for (const [, , options] of settingsRequests) expect(options).toMatchObject({ retry: 'none' });
        expect(storage.getState().settingsVersion).toBe(0);
    });

    it('applies the response over the queue as it is then, keeping an edit made while the write was in flight', async () => {
        serve({ content: { t: 'plain', v: { analyticsOptOut: false, connectedServicesManagementV1: managedByVm } } });
        let liveQueue: Partial<Settings> = {};
        const answer = boundary.serverFetch.getMockImplementation()!;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            if (path === '/v2/account/settings' && init?.method === 'POST') liveQueue = { analyticsOptOut: true };
            return await answer(path, init, options);
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);

        await syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            readPendingSettings: () => ({ persisted: {}, live: liveQueue }),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: (current) => ({ ...(current as typeof managedByVm), poolsPaused: true }) },
        });

        expect(storage.getState().settings.analyticsOptOut).toBe(true);
    });

    it('does not drop an edit queued during a sync when it clears a queued one-shot value', async () => {
        serve({ content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const staleManagement = { v: 1, managingMachineId: 'old-mac', poolsPaused: true };
        // On disk and when this sync takes the queue: only the old management value. In the live queue, once
        // the sync is under way: an edit made since, not saved yet (its save is debounced).
        const queued = { connectedServicesManagementV1: staleManagement } as Partial<Settings>;
        savePendingSettings(queued);
        let live = queued;
        const answer = boundary.serverFetch.getMockImplementation()!;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            if (path === '/v2/account/settings') live = { ...queued, analyticsOptOut: true };
            return await answer(path, init, options);
        });
        const clearPendingSettings = vi.fn();

        await syncSettings({
            credentials, encryption, clearPendingSettings, pendingSettings: queued,
            readPendingSettings: () => ({ persisted: queued, live }),
        });

        expect(clearPendingSettings).toHaveBeenCalled();
        for (const [queue] of clearPendingSettings.mock.calls) expect(queue).toMatchObject({ analyticsOptOut: true });
        expect(storage.getState().settings.connectedServicesManagementV1).toEqual(managedByVm);
    });

    /** The queue as the app keeps it: a persisted copy shared by the account's tabs and this tab's live edits. */
    function createPendingQueue(initial: Readonly<{ persisted: Partial<Settings>; live: Partial<Settings> }>) {
        const queue = { ...initial };
        return {
            queue,
            readPendingSettings: () => ({ persisted: queue.persisted, live: queue.live }),
            clearPendingSettings: (next: Partial<Settings>) => {
                queue.persisted = next;
                queue.live = next;
            },
        };
    }

    it('a sync that waited submits the queue as it is at its turn, not an edit an earlier run committed', async () => {
        serve({ content: { t: 'plain', v: {} } });
        const answer = boundary.serverFetch.getMockImplementation()!;
        let releasePost!: () => void;
        const postHeld = new Promise<void>((resolve) => { releasePost = resolve; });
        let firstPost = true;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            if (path === '/v2/account/settings' && init?.method === 'POST' && firstPost) {
                firstPost = false;
                await postHeld;
            }
            return await answer(path, init, options);
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const pending = createPendingQueue({ persisted: {}, live: { analyticsOptOut: true } });
        const run = () => syncSettings({
            credentials, encryption, pendingSettings: { ...pending.queue.live },
            clearPendingSettings: pending.clearPendingSettings, readPendingSettings: pending.readPendingSettings,
        });

        const first = run();
        await vi.waitFor(() => expect(firstPost).toBe(false));
        const waiting = run();
        releasePost();
        await first;
        await waiting;

        expect(posts()).toHaveLength(1);
        expect(pending.queue.live).toEqual({});
    });

    it('keeps a different value another tab saved for a key this sync submitted', async () => {
        serve({ content: { t: 'plain', v: {} } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const pending = createPendingQueue({ persisted: { analyticsOptOut: false }, live: { analyticsOptOut: false } });
        const answer = boundary.serverFetch.getMockImplementation()!;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            // The other tab saves its choice while this write is in flight, then closes before uploading it.
            if (path === '/v2/account/settings' && init?.method === 'POST') pending.queue.persisted = { analyticsOptOut: true };
            return await answer(path, init, options);
        });

        await syncSettings({
            credentials, encryption, pendingSettings: { analyticsOptOut: false },
            clearPendingSettings: pending.clearPendingSettings, readPendingSettings: pending.readPendingSettings,
        });

        expect(posts()).toMatchObject([{ content: { v: { analyticsOptOut: false } } }]);
        expect(pending.queue.live).toEqual({ analyticsOptOut: true });
    });

    it('keeps another tab\'s saved edit when this tab submits an unsaved edit of a different key', async () => {
        serve({ content: { t: 'plain', v: {} } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        // The other tab saved its opt-out and closed; this tab's edit is still waiting for its debounced save.
        const pending = createPendingQueue({ persisted: { analyticsOptOut: true }, live: { crashReportsOptOut: true } });

        await syncSettings({
            credentials, encryption, pendingSettings: { crashReportsOptOut: true },
            clearPendingSettings: pending.clearPendingSettings, readPendingSettings: pending.readPendingSettings,
        });

        expect(posts()).toMatchObject([{ content: { v: { crashReportsOptOut: true } } }]);
        expect(pending.queue).toEqual({ persisted: { analyticsOptOut: true }, live: { analyticsOptOut: true } });
    });

    it('sends nothing for an exclusive update while the relay has switched and the account has not followed yet', async () => {
        serve({ content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } } });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const scopeA = createAccountSettingsScope('server-a', 'account-1')!;
        storage.setState({ settingsScope: scopeA });
        boundary.serverId = 'server-b';
        boundary.serverUrl = 'https://relay-b.example.test';
        const decide = vi.fn();

        await expect(syncSettings({
            credentials, encryption, settingsScope: scopeA, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide },
        })).rejects.toThrow();

        expect(decide).not.toHaveBeenCalled();
        expect(boundary.serverFetch).not.toHaveBeenCalled();
    });

    it('lets a queued sync start only after an exclusive update has applied its response', async () => {
        serve({ content: { t: 'plain', v: { analyticsOptOut: false, connectedServicesManagementV1: managedByVm } } });
        const answer = boundary.serverFetch.getMockImplementation()!;
        let releasePost!: () => void;
        const postHeld = new Promise<void>((resolve) => { releasePost = resolve; });
        let firstPost = true;
        const requests: string[] = [];
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            requests.push(`${init?.method ?? 'GET'} ${path}`);
            if (path === '/v2/account/settings' && init?.method === 'POST' && firstPost) {
                firstPost = false;
                await postHeld;
            }
            return await answer(path, init, options);
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);

        const exclusive = syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: (current) => ({ ...(current as typeof managedByVm), poolsPaused: true }) },
        });
        await vi.waitFor(() => expect(requests).toContain('POST /v2/account/settings'));
        const queued = syncSettings({
            credentials, encryption, pendingSettings: { analyticsOptOut: true }, clearPendingSettings: vi.fn(),
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        const whileHeld = [...requests];
        releasePost();
        await Promise.all([exclusive, queued]);

        expect(whileHeld.filter((request) => request.endsWith('/v2/account/settings'))).toEqual([
            'GET /v2/account/settings', 'POST /v2/account/settings',
        ]);
        expect(requests.filter((request) => request.endsWith('/v2/account/settings'))).toHaveLength(4);
    });

    it('sends nothing for an account or server that stopped being active while the run waited for its turn', async () => {
        serve({ content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } } });
        const answer = boundary.serverFetch.getMockImplementation()!;
        let releasePost!: () => void;
        const postHeld = new Promise<void>((resolve) => { releasePost = resolve; });
        let firstPost = true;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            if (path === '/v2/account/settings' && init?.method === 'POST' && firstPost) {
                firstPost = false;
                await postHeld;
            }
            return await answer(path, init, options);
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);
        const scopeA = createAccountSettingsScope('server-a', 'account-1')!;
        storage.setState({ settingsScope: scopeA });

        const first = syncSettings({
            credentials, encryption, settingsScope: scopeA, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: (current) => ({ ...(current as typeof managedByVm), poolsPaused: true }) },
        });
        await vi.waitFor(() => expect(firstPost).toBe(false));
        const queued = syncSettings({
            credentials, encryption, settingsScope: scopeA, pendingSettings: { analyticsOptOut: true }, clearPendingSettings: vi.fn(),
        });
        const queuedExclusive = syncSettings({
            credentials, encryption, settingsScope: scopeA, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: () => ({ ...managedByVm, managingMachineId: 'mac' }) },
        });
        storage.setState({ settingsScope: createAccountSettingsScope('server-b', 'account-1')! });
        const requestsBeforeRelease = boundary.serverFetch.mock.calls.length;
        releasePost();

        await first;
        await queued;
        await expect(queuedExclusive).rejects.toThrow();
        expect(boundary.serverFetch.mock.calls.length).toBe(requestsBeforeRelease);
    });

    it('sends nothing when the relay switched while the run waited, before the settings scope followed', async () => {
        serve({ content: { t: 'plain', v: { connectedServicesManagementV1: managedByVm } } });
        const answer = boundary.serverFetch.getMockImplementation()!;
        let releasePost!: () => void;
        const postHeld = new Promise<void>((resolve) => { releasePost = resolve; });
        let firstPost = true;
        boundary.serverFetch.mockImplementation(async (path: string, init?: RequestInit, options?: unknown) => {
            if (path === '/v2/account/settings' && init?.method === 'POST' && firstPost) {
                firstPost = false;
                await postHeld;
            }
            return await answer(path, init, options);
        });
        const encryption = await createEncryptionFromAuthCredentials(credentials);

        const first = syncSettings({
            credentials, encryption, pendingSettings: {}, clearPendingSettings: vi.fn(),
            exclusiveUpdate: { key: 'connectedServicesManagementV1', decide: (current) => ({ ...(current as typeof managedByVm), poolsPaused: true }) },
        });
        await vi.waitFor(() => expect(firstPost).toBe(false));
        const queued = syncSettings({ credentials, encryption, pendingSettings: { analyticsOptOut: true }, clearPendingSettings: vi.fn() });
        boundary.serverUrl = 'https://relay-b.example.test';
        const requestsBeforeRelease = boundary.serverFetch.mock.calls.length;
        releasePost();

        await first;
        await queued;
        expect(boundary.serverFetch.mock.calls.length).toBe(requestsBeforeRelease);
    });
});
