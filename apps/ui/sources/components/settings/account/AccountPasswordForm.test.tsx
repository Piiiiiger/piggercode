import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { installFakePasswordRelay } from '@/auth/password/passwordRelayTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const runtimeFetchMock = vi.hoisted(() => vi.fn());
const ACCOUNT_SECRET = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-a', serverUrl: 'https://relay.example.test', generation: 1 }),
}));

// The HTTP client is the network boundary for this component.
vi.mock('@/sync/http/client', () => ({
    serverFetch: (path: string, init?: RequestInit) => runtimeFetchMock(`https://relay.example.test${path}`, init),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: { token: 'token-1', secret: ACCOUNT_SECRET } }),
}));

afterEach(() => {
    standardCleanup();
    runtimeFetchMock.mockReset();
});

function passwordWrites(): unknown[][] {
    return runtimeFetchMock.mock.calls.filter(([input, init]) =>
        String(input).endsWith('/v1/account/password') && (init as RequestInit | undefined)?.method === 'POST');
}

async function fill(screen: Awaited<ReturnType<typeof renderScreen>>, values: Readonly<{ username: string; password: string; confirm: string }>) {
    screen.changeTextByTestId('account-password-username', values.username);
    screen.changeTextByTestId('account-password-new', values.password);
    screen.changeTextByTestId('account-password-confirm', values.confirm);
    await flushHookEffects();
}

describe('AccountPasswordForm', () => {
    it('saves the username and password and confirms which name to sign in with', async () => {
        const relay = installFakePasswordRelay(runtimeFetchMock);
        const { AccountPasswordForm } = await import('./AccountPasswordForm');
        const screen = await renderScreen(<AccountPasswordForm />);
        await vi.waitFor(() => expect(screen.findByTestId('account-password-status')).not.toBeNull());

        await fill(screen, { username: 'Pigger', password: 'correct horse battery', confirm: 'correct horse battery' });
        await screen.pressByTestIdAsync('account-password-save');

        await vi.waitFor(() => expect(screen.findByTestId('account-password-saved')).not.toBeNull(), { timeout: 20_000 });
        expect(relay.readStored()?.username).toBe('pigger');
        expect(screen.findByTestId('account-password-new')?.props.value).toBe('');
    }, 30_000);

    it('checks the password length and confirmation before sending anything', async () => {
        installFakePasswordRelay(runtimeFetchMock);
        const { AccountPasswordForm } = await import('./AccountPasswordForm');
        const screen = await renderScreen(<AccountPasswordForm />);

        await fill(screen, { username: 'pigger', password: 'short', confirm: 'short' });
        await screen.pressByTestIdAsync('account-password-save');
        await fill(screen, { username: 'pigger', password: 'correct horse battery', confirm: 'different horse battery' });
        await screen.pressByTestIdAsync('account-password-save');
        await flushHookEffects();

        expect(passwordWrites()).toHaveLength(0);
        expect(screen.findByTestId('account-password-confirm')?.props.value).toBe('different horse battery');
    });

    it('reports a taken username and keeps what was typed', async () => {
        installFakePasswordRelay(runtimeFetchMock, { takenUsernames: ['taken'] });
        const { AccountPasswordForm } = await import('./AccountPasswordForm');
        const screen = await renderScreen(<AccountPasswordForm />);

        await fill(screen, { username: 'taken', password: 'correct horse battery', confirm: 'correct horse battery' });
        await screen.pressByTestIdAsync('account-password-save');

        await vi.waitFor(() => expect(passwordWrites()).toHaveLength(1), { timeout: 20_000 });
        await flushHookEffects();
        expect(screen.findAllByTestId('account-password-saved')).toHaveLength(0);
        expect(screen.findByTestId('account-password-username')?.props.value).toBe('taken');
    }, 30_000);
});
