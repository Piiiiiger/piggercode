import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { OS: 'web' },
        AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    });
});

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/voice/context/voiceHooks', () => ({
    voiceHooks: {
        onSessionFocus: vi.fn(),
        onSessionOffline: vi.fn(),
        onSessionOnline: vi.fn(),
        onMessages: vi.fn(),
        onReady: vi.fn(),
        reportContextualUpdate: vi.fn(),
    },
}));

vi.mock('@/track', () => ({
    initializeTracking: vi.fn(),
    tracking: null,
    trackPaywallPresented: vi.fn(),
    trackPaywallPurchased: vi.fn(),
    trackPaywallCancelled: vi.fn(),
    trackPaywallRestored: vi.fn(),
    trackPaywallError: vi.fn(),
}));

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        request: requestMock,
        emitWithAck: vi.fn(),
        send: vi.fn(),
        onMessage: vi.fn(),
        onStatusChange: vi.fn(),
        onReconnected: vi.fn(),
        disconnect: vi.fn(),
        initialize: vi.fn(),
    },
}));

const directTailReadMock = vi.hoisted(() => vi.fn());
const directTranscriptPageMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/ops/machineDirectSessions', () => ({
    machineDirectSessionTranscriptReadAfter: directTailReadMock,
    machineDirectSessionTranscriptPage: directTranscriptPageMock,
}));

import { storage } from './domains/state/storage';
import type { Session } from './domains/state/storageTypes';
import { markSessionVisible } from '@/sync/domains/session/activeViewingSession';

type SyncDirectReadTestAccess = {
    encryption: { getSessionEncryption: (sessionId: string) => null };
    activeServerSessionIds: Set<string>;
    hasFetchedSessionsSnapshotForActiveServer: boolean;
    isForeground: boolean;
};

const initialStorageState = storage.getState();
const SESSION_ID = 's-direct-read';
// What a daemon answers when Codex history holds an item it cannot read (CLI 0.3.0, Codex 0.165).
const UNREADABLE = {
    ok: false,
    errorCode: 'provider_unavailable',
    error: 'Codex history could not be read completely: Codex native history contains an unsupported transcript item',
} as const;

function directSession(): Session {
    const now = Date.now();
    return {
        id: SESSION_ID,
        seq: 0,
        encryptionMode: 'plain',
        createdAt: now,
        updatedAt: now,
        active: false,
        activeAt: now,
        metadata: {
            directSessionV1: { v: 1, providerId: 'codex', machineId: 'm-1', remoteSessionId: 'r-1', source: { kind: 'codexHome', home: 'user' } },
        } as unknown as Session['metadata'],
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        optimisticThinkingAt: null,
    };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function openDirectSession() {
    const { sync } = await import('./sync');
    const t = sync as unknown as SyncDirectReadTestAccess;
    sync.disconnectServer();
    storage.getState().applySessions([directSession()]);
    t.encryption = { getSessionEncryption: () => null };
    t.activeServerSessionIds = new Set<string>([SESSION_ID]);
    t.hasFetchedSessionsSnapshotForActiveServer = true;
    t.isForeground = true;
    markSessionVisible(SESSION_ID);
    return sync;
}

const failure = () => storage.getState().sessionTranscriptReadFailure[SESSION_ID] ?? null;

describe('a Direct transcript the machine cannot read', () => {
    beforeEach(() => {
        storage.setState(initialStorageState, true);
        requestMock.mockReset();
        directTailReadMock.mockReset();
        directTranscriptPageMock.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('records why the machine could not read it, and clears that once a read succeeds', async () => {
        directTranscriptPageMock
            .mockResolvedValueOnce(UNREADABLE)
            .mockResolvedValue({
                ok: true,
                items: [{ id: 'q1', createdAtMs: 1, raw: { role: 'user', content: { type: 'text', text: 'question' } } }],
                nextCursor: null,
                tailCursor: 'c-1',
                hasMore: false,
            });
        const sync = await openDirectSession();

        void sync.refreshSessionMessages(SESSION_ID);
        await waitFor(() => failure() !== null);
        expect(failure()).toMatchObject({ code: 'provider_unavailable', message: UNREADABLE.error });

        // The messages sync retries on its own; the read that succeeds takes the failure away.
        await waitFor(() => storage.getState().sessionMessages[SESSION_ID]?.isLoaded === true);
        expect(failure()).toBeNull();
    });

    it('settles a reader-requested retry with the read it started', async () => {
        directTranscriptPageMock.mockResolvedValue(UNREADABLE);
        const sync = await openDirectSession();
        void sync.refreshSessionMessages(SESSION_ID);
        await waitFor(() => failure() !== null);
        const first = failure();

        // Still unreadable: the retry settles when that read fails again, rather than waiting
        // for a success the machine cannot give.
        await sync.retrySessionTranscriptRead(SESSION_ID);
        expect(failure()).not.toBeNull();
        expect(failure()).not.toBe(first);
    });
});
