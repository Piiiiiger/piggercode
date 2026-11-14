import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { ProviderLocalAuthLaunch } from '@/agents/providers/shared/providerLocalAuthPlugin';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

const mockMachine = {
    id: 'machine-1',
    seq: 0,
    createdAt: 0,
    updatedAt: 0,
    active: true,
    activeAt: 0,
    metadata: {
        host: 'vm',
        platform: 'linux',
        happyCliVersion: '0.0.0-test',
        happyHomeDir: '/home/tester/.happy',
        homeDir: '/home/tester',
    },
    metadataVersion: 0,
    daemonState: null,
    daemonStateVersion: 0,
} satisfies Machine;

/**
 * The machine's end of the login's terminal (the daemon's terminal calls, the boundary under test): what the login
 * prints waits in `pending` until the view reads it; what the view types lands in `inputs`.
 */
const machineTerminal = vi.hoisted(() => ({
    pending: [] as Array<Record<string, unknown>>,
    inputs: [] as string[],
    ensureRequests: [] as Array<Record<string, unknown>>,
    closed: [] as string[],
    /** The next read fails as a terminal the machine lost track of does (the view then connects again). */
    failNextRead: false,
}));
const clipboard = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('@/sync/ops/machineTerminal', () => ({
    machineTerminalEnsure: async (_machineId: string, request: Record<string, unknown>) => {
        machineTerminal.ensureRequests.push(request);
        return { ok: true, terminalId: 'terminal-1', reused: false };
    },
    machineTerminalRestart: async () => ({ ok: true, terminalId: 'terminal-1', reused: false }),
    machineTerminalStreamRead: async (_machineId: string, request: { cursor: number }) => {
        if (machineTerminal.failNextRead) {
            machineTerminal.failNextRead = false;
            return { ok: false, errorCode: 'terminal_not_found', error: 'terminal not found' };
        }
        if (machineTerminal.pending.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { ok: true, terminalId: 'terminal-1', events: [], nextCursor: request.cursor, done: false, waited: true };
        }
        const events = machineTerminal.pending.splice(0);
        return { ok: true, terminalId: 'terminal-1', events, nextCursor: request.cursor + events.length, done: false };
    },
    machineTerminalInput: async (_machineId: string, request: { data: string }) => {
        machineTerminal.inputs.push(request.data);
        return { ok: true };
    },
    machineTerminalResize: async () => ({ ok: true }),
    machineTerminalClose: async (_machineId: string, request: { terminalId: string }) => {
        machineTerminal.closed.push(request.terminalId);
        return { ok: true };
    },
}));

vi.mock('@/utils/ui/clipboard', () => ({
    setClipboardStringSafe: async (value: string) => {
        clipboard.value = value;
        return true;
    },
}));

vi.mock('@/utils/sessions/machineUtils', () => ({
    isMachineOnline: () => true,
}));

installSettingsViewCommonModuleMocks({
    storage: async (importOriginal) => {
        const storage = await importOriginal<typeof import('@/sync/domains/state/storage')>();
        return {
            ...storage,
            useMachine: (_machineId: string) => mockMachine,
        };
    },
});

const LINK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=client-1&response_type=code&state=state-1';
const authLaunch: ProviderLocalAuthLaunch = { kind: 'primary', initialCommand: 'claude auth login', signIn: 'link_then_code' };

async function openLinkLogin(onEnded = vi.fn()) {
    const { ProviderAuthenticationLinkLogin } = await import('./ProviderAuthenticationLinkLogin');
    const screen = await renderScreen(
        <ProviderAuthenticationLinkLogin
            providerId="claude"
            machineId="machine-1"
            machineHomeDir="/home/tester"
            authLaunch={authLaunch}
            onEnded={onEnded}
            onRequestClose={vi.fn()}
            onRestart={vi.fn()}
        />,
    );
    return { screen, onEnded };
}

describe('ProviderAuthenticationLinkLogin', () => {
    beforeEach(() => {
        machineTerminal.pending.length = 0;
        machineTerminal.inputs.length = 0;
        machineTerminal.ensureRequests.length = 0;
        machineTerminal.closed.length = 0;
        machineTerminal.failNextRead = false;
        clipboard.value = null;
    });
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('offers the login\'s link, types the pasted code into the login, and shows its answer', async () => {
        const { screen, onEnded } = await openLinkLogin();
        machineTerminal.pending.push(
            { t: 'data', data: `Opening browser to sign in…\r\nIf the browser didn't open, visit: ${LINK}\r\nPaste code here if prompted > ` },
            { t: 'url', url: LINK, kind: 'auth', suggestOpen: true },
        );

        await vi.waitFor(() => expect(screen.findByTestId('provider-link-login-link')?.props.children).toBe(LINK));
        // The login always ends its shell, so the view sees it end whether it worked or not.
        expect(machineTerminal.ensureRequests[0]).toMatchObject({ initialCommand: 'claude auth login; exit', cwd: '/home/tester' });

        await screen.pressByTestIdAsync('provider-link-login-copy');
        expect(clipboard.value).toBe(LINK);

        await act(async () => {
            screen.findByTestId('provider-link-login-code')!.props.onChangeText('  code-1#state-1 ');
        });
        await screen.pressByTestIdAsync('provider-link-login-submit');
        await vi.waitFor(() => expect(machineTerminal.inputs.join('')).toBe('code-1#state-1\r'));

        machineTerminal.pending.push(
            { t: 'data', data: 'code-1#state-1\r\nLogin successful.\r\nexit\r\n' },
            { t: 'exit', exitCode: 0, signal: null },
        );
        await vi.waitFor(() => expect(screen.findByTestId('provider-link-login-answer')?.props.children).toBe('Login successful.'));
        expect(onEnded).toHaveBeenCalledTimes(1);
    });

    it('takes the code only while the login\'s terminal is connected', async () => {
        const { screen } = await openLinkLogin();
        machineTerminal.pending.push(
            { t: 'data', data: `If the browser didn't open, visit: ${LINK}\r\nPaste code here if prompted > ` },
            { t: 'url', url: LINK, kind: 'auth' },
        );
        await vi.waitFor(() => expect(screen.findByTestId('provider-link-login-link')?.props.children).toBe(LINK));
        await act(async () => {
            screen.findByTestId('provider-link-login-code')!.props.onChangeText('code-1#state-1');
        });

        machineTerminal.failNextRead = true;
        await vi.waitFor(() => expect(screen.findByProps({ testID: 'provider-link-login-submit' }).props.disabled).toBe(true));
        await screen.pressByTestIdAsync('provider-link-login-submit');
        expect(machineTerminal.inputs).toEqual([]);

        await vi.waitFor(
            () => expect(screen.findByProps({ testID: 'provider-link-login-submit' }).props.disabled).toBe(false),
            { timeout: 5_000 },
        );
    });

    it('shows what a login that stopped before giving a link said', async () => {
        const { screen, onEnded } = await openLinkLogin();
        machineTerminal.pending.push(
            { t: 'data', data: "\u001b[31merror: unknown command 'auth'\u001b[0m\r\n" },
            { t: 'exit', exitCode: 1, signal: null },
        );

        await vi.waitFor(() => expect(screen.findByTestId('provider-link-login-answer')?.props.children).toBe("error: unknown command 'auth'"));
        expect(screen.findByTestId('provider-link-login-link')).toBeNull();
        expect(onEnded).toHaveBeenCalledTimes(1);
    });
});
