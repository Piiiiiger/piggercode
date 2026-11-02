import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { installFakePasswordRelay } from '@/auth/password/passwordRelayTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const runtimeFetchMock = vi.hoisted(() => vi.fn());
const authLoginMock = vi.hoisted(() => vi.fn(async (_token: string, _secret: string) => {}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://relay.example.test', generation: 1 }),
}));

// The HTTP client is the network boundary for this component; its reachability gating is covered elsewhere.
vi.mock('@/sync/http/client', () => ({
    serverFetch: (path: string, init?: RequestInit) => runtimeFetchMock(`https://relay.example.test${path}`, init),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ login: authLoginMock }),
}));

afterEach(() => {
    standardCleanup();
    runtimeFetchMock.mockReset();
    authLoginMock.mockClear();
});

async function setPasswordOnRelay(secret: string) {
    const { setAccountPassword } = await import('@/auth/password/passwordLogin');
    await setAccountPassword({ credentials: { token: 'token-before', secret }, username: 'pigger', password: 'correct horse battery' });
}

describe('PasswordLoginForm', () => {
    it('signs in and stores the session through the auth owner', async () => {
        const relay = installFakePasswordRelay(runtimeFetchMock);
        const { encodeBase64 } = await import('@/encryption/base64');
        const secret = encodeBase64(new Uint8Array(32).fill(3), 'base64url');
        await setPasswordOnRelay(secret);
        const { PasswordLoginForm } = await import('./PasswordLoginForm');

        const screen = await renderScreen(<PasswordLoginForm onUseRecoveryKey={() => {}} />);
        screen.changeTextByTestId('password-login-username', 'Pigger');
        screen.changeTextByTestId('password-login-password', 'correct horse battery');
        await flushHookEffects();
        await screen.pressByTestIdAsync('password-login-submit');

        await vi.waitFor(() => expect(authLoginMock).toHaveBeenCalled(), { timeout: 20_000 });
        expect(authLoginMock).toHaveBeenCalledWith('token-from-key-challenge', secret);
        expect(relay.keyChallengeBodies).toHaveLength(1);
        expect(screen.findByTestId('password-login-error')).toBeNull();
    }, 30_000);

    it('shows an error and keeps the entered username when the password is wrong', async () => {
        installFakePasswordRelay(runtimeFetchMock);
        const { encodeBase64 } = await import('@/encryption/base64');
        await setPasswordOnRelay(encodeBase64(new Uint8Array(32).fill(4), 'base64url'));
        const { PasswordLoginForm } = await import('./PasswordLoginForm');

        const screen = await renderScreen(<PasswordLoginForm onUseRecoveryKey={() => {}} />);
        screen.changeTextByTestId('password-login-username', 'pigger');
        screen.changeTextByTestId('password-login-password', 'wrong horse battery');
        await flushHookEffects();
        await screen.pressByTestIdAsync('password-login-submit');

        await vi.waitFor(() => expect(screen.findByTestId('password-login-error')).not.toBeNull(), { timeout: 20_000 });
        expect(authLoginMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('password-login-username')?.props.value).toBe('pigger');
    }, 30_000);
});
