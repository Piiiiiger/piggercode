import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakePasswordRelay } from './passwordRelayTestHelpers';

const runtimeFetchMock = vi.hoisted(() => vi.fn());

// The HTTP client is the network boundary for these flows; its reachability gating has its own tests.
vi.mock('@/sync/http/client', () => ({
    serverFetch: (path: string, init?: RequestInit) => runtimeFetchMock(`https://relay.example.test${path}`, init),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://relay.example.test', generation: 1 }),
}));

afterEach(() => {
    runtimeFetchMock.mockReset();
    vi.resetModules();
});

function passwordRouteCalls(): unknown[][] {
    return runtimeFetchMock.mock.calls.filter(([input]) => /\/v1\/(account\/password|auth\/password)/.test(String(input)));
}

describe('password login', () => {
    it('logs back in with the password it was set with and recovers the same account secret', async () => {
        const relay = installFakePasswordRelay(runtimeFetchMock);
        const { encodeBase64 } = await import('@/encryption/base64');
        const { loginWithPassword, setAccountPassword } = await import('./passwordLogin');
        const secret = encodeBase64(new Uint8Array(32).map((_, index) => index + 1), 'base64url');

        const username = await setAccountPassword({
            credentials: { token: 'token-before', secret },
            username: ' Pigger ',
            password: 'correct horse battery',
        });
        expect(username).toBe('pigger');
        expect(relay.readStored()?.wrappedSecret).not.toContain(secret);

        const session = await loginWithPassword({ username: 'PIGGER', password: 'correct horse battery' });
        expect(session).toEqual({ token: 'token-from-key-challenge', secret });
        expect(relay.keyChallengeBodies).toHaveLength(1);
    }, 30_000);

    it('reports invalid credentials for a wrong password or an unknown name without signing in', async () => {
        const relay = installFakePasswordRelay(runtimeFetchMock);
        const { encodeBase64 } = await import('@/encryption/base64');
        const { loginWithPassword, setAccountPassword, PasswordLoginError } = await import('./passwordLogin');
        await setAccountPassword({
            credentials: { token: 'token-before', secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url') },
            username: 'pigger',
            password: 'correct horse battery',
        });

        await expect(loginWithPassword({ username: 'pigger', password: 'wrong horse battery' }))
            .rejects.toEqual(new PasswordLoginError('invalid-credentials'));
        await expect(loginWithPassword({ username: 'nobody', password: 'correct horse battery' }))
            .rejects.toEqual(new PasswordLoginError('invalid-credentials'));
        expect(relay.keyChallengeBodies).toHaveLength(0);
    }, 30_000);

    it('refuses a short password before contacting the relay', async () => {
        installFakePasswordRelay(runtimeFetchMock);
        const { setAccountPassword, PasswordLoginError } = await import('./passwordLogin');
        await expect(setAccountPassword({
            credentials: { token: 'token-before', secret: 'c2VjcmV0' },
            username: 'pigger',
            password: 'short',
        })).rejects.toEqual(new PasswordLoginError('password-too-short'));
        expect(passwordRouteCalls()).toHaveLength(0);
    });
});
