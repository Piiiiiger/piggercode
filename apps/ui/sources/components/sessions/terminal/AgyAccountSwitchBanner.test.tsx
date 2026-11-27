import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => (
            params ? `${key} ${JSON.stringify(params)}` : key
        ),
    });
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: (props: any) => React.createElement('RoundButton', props),
}));

// The session RPC is the machine boundary; the real op and mapping run above it.
const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: rpc.call,
}));

import { storage } from '@/sync/domains/state/storageStore';
import { AgyAccountSwitchBanner } from './AgyAccountSwitchBanner';

const NOW = Date.UTC(2026, 10, 27, 3, 0, 0);

function setMetadata(extra: Record<string, unknown>) {
    const base = createSessionFixture({ id: 's1' });
    storage.setState((state) => ({
        ...state,
        sessions: { ...state.sessions, s1: { ...base, metadata: { ...base.metadata!, ...extra } as any } },
    }));
}

async function renderBanner() {
    return renderScreen(<AgyAccountSwitchBanner sessionId="s1" testIdPrefix="p" />);
}

describe('AgyAccountSwitchBanner', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        vi.setSystemTime(NOW);
        rpc.call.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
        storage.setState((state) => ({ ...state, sessions: {} }));
    });

    it('renders nothing for an old CLI that writes neither field, or a malformed one', async () => {
        setMetadata({});
        expect((await renderBanner()).findByTestId('p-agy-account-banner')).toBeNull();

        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'nonsense', updatedAtMs: NOW } });
        expect((await renderBanner()).findByTestId('p-agy-account-banner')).toBeNull();
    });

    it('renders nothing for state none', async () => {
        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'none', updatedAtMs: NOW } });
        expect((await renderBanner()).findByTestId('p-agy-account-banner')).toBeNull();
    });

    it('says which account it will switch to, why, and what it waits for', async () => {
        setMetadata({
            agyAccountSwitchV1: { v: 1, state: 'waiting', reason: 'low', toAccountId: 'b', waitingFor: 'draft', updatedAtMs: NOW },
        });
        const text = (await renderBanner()).getTextContent();
        expect(text).toContain('terminalEmbedded.agyAccount.waitingLow');
        expect(text).toContain('connectedServices.agyUsage.namedAccount');
        expect(text).toContain('terminalEmbedded.agyAccount.waitingFor.draft');

        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'waiting', reason: 'exhausted', toAccountId: 'b', updatedAtMs: NOW } });
        expect((await renderBanner()).getTextContent()).toContain('terminalEmbedded.agyAccount.waitingExhausted');
    });

    it('shows the earliest reset as local HH:MM when all accounts are used up', async () => {
        const reset = new Date(2026, 10, 27, 7, 5).getTime();
        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'all_exhausted', earliestResetAtMs: reset, updatedAtMs: NOW } });
        const text = (await renderBanner()).getTextContent();
        expect(text).toContain('terminalEmbedded.agyAccount.allExhaustedAt');
        expect(text).toContain('07:05');

        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'all_exhausted', earliestResetAtMs: null, updatedAtMs: NOW } });
        expect((await renderBanner()).getTextContent()).toContain('terminalEmbedded.agyAccount.allExhausted');
    });

    it('tells a failed switch from a failed start of agy itself', async () => {
        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'failed', failure: 'target_start_failed', fromAccountId: 'default', toAccountId: 'b', updatedAtMs: NOW } });
        expect((await renderBanner()).getTextContent()).toContain('terminalEmbedded.agyAccount.failedTarget');

        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'failed', failure: 'source_start_failed', updatedAtMs: NOW } });
        expect((await renderBanner()).getTextContent()).toContain('terminalEmbedded.agyAccount.failedSource');
    });

    it('hides "all used up" once its reset time has passed, as nothing else clears it on a machine with one login', async () => {
        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'all_exhausted', earliestResetAtMs: NOW + 60_000, updatedAtMs: NOW } });
        const screen = await renderBanner();
        expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.allExhaustedAt');
        await act(async () => {
            vi.advanceTimersByTime(61_000);
        });
        expect(screen.findByTestId('p-agy-account-banner')).toBeNull();
    });

    it('shows a switch for a minute after the CLI wrote it, then hides it', async () => {
        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'switched', fromAccountId: 'default', toAccountId: 'b', updatedAtMs: NOW - 10_000 } });
        const screen = await renderBanner();
        expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.switched');

        await act(async () => {
            vi.advanceTimersByTime(49_000);
        });
        expect(screen.findByTestId('p-agy-account-banner')).not.toBeNull();

        await act(async () => {
            vi.advanceTimersByTime(1_500);
        });
        expect(screen.findByTestId('p-agy-account-banner')).toBeNull();
    });

    it('does not show a switch that is already older than a minute', async () => {
        setMetadata({ agyAccountSwitchV1: { v: 1, state: 'switched', toAccountId: 'b', updatedAtMs: NOW - 61_000 } });
        expect((await renderBanner()).findByTestId('p-agy-account-banner')).toBeNull();
    });

    describe('the confirm button', () => {
        const confirmState = { v: 1, state: 'needs_confirmation', requestId: 'r1', toAccountId: 'b', updatedAtMs: NOW };

        it('is only there while a switch needs confirmation, and carries the request id to the session RPC', async () => {
            setMetadata({ agyAccountSwitchV1: { ...confirmState, state: 'waiting' } });
            expect((await renderBanner()).findByTestId('p-agy-account-confirm')).toBeNull();

            let resolve!: (value: unknown) => void;
            rpc.call.mockReturnValue(new Promise((r) => { resolve = r; }));
            setMetadata({ agyAccountSwitchV1: confirmState });
            const screen = await renderBanner();
            expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.needsConfirmation');
            expect(screen.findByTestId('p-agy-account-confirm')?.props.disabled).toBe(false);

            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(rpc.call).toHaveBeenCalledTimes(1);
            expect(rpc.call).toHaveBeenCalledWith(expect.objectContaining({
                sessionId: 's1',
                method: 'agy.accountSwitch.confirm',
                payload: { requestId: 'r1' },
            }));
            // Pending: down, so a second press cannot send again.
            expect(screen.findByTestId('p-agy-account-confirm')?.props.disabled).toBe(true);

            await act(async () => {
                resolve({ ok: true });
            });
            expect(screen.findByTestId('p-agy-account-confirm')?.props.disabled).toBe(true);
        });

        it('says whether the account is used up or almost, and drops an earlier failure note when it tries again', async () => {
            setMetadata({ agyAccountSwitchV1: { ...confirmState, reason: 'low' } });
            expect((await renderBanner()).getTextContent()).toContain('terminalEmbedded.agyAccount.needsConfirmationLow');
            setMetadata({ agyAccountSwitchV1: { ...confirmState, reason: 'exhausted' } });
            expect((await renderBanner()).getTextContent()).toContain('terminalEmbedded.agyAccount.needsConfirmationExhausted');

            rpc.call.mockRejectedValueOnce(new Error('offline'));
            const screen = await renderBanner();
            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.confirmFailed');
            let resolve!: (value: unknown) => void;
            rpc.call.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(screen.getTextContent()).not.toContain('terminalEmbedded.agyAccount.confirmFailed');
            await act(async () => {
                resolve({ ok: true });
            });
        });

        it('comes back with a retry message when the call failed', async () => {
            rpc.call.mockRejectedValue(new Error('offline'));
            setMetadata({ agyAccountSwitchV1: confirmState });
            const screen = await renderBanner();
            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.confirmFailed');
            expect(screen.findByTestId('p-agy-account-confirm')?.props.disabled).toBe(false);
        });

        it('asks for an update of this machine when the method is unknown, and drops the button', async () => {
            rpc.call.mockRejectedValue(Object.assign(new Error('x'), { rpcErrorCode: 'RPC_METHOD_NOT_AVAILABLE' }));
            setMetadata({ agyAccountSwitchV1: confirmState });
            const screen = await renderBanner();
            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.needsUpdate');
            expect(screen.findByTestId('p-agy-account-confirm')).toBeNull();
        });

        it('treats a not_supported answer like an unknown method', async () => {
            rpc.call.mockResolvedValue({ ok: false, reason: 'not_supported' });
            setMetadata({ agyAccountSwitchV1: confirmState });
            const screen = await renderBanner();
            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(screen.getTextContent()).toContain('terminalEmbedded.agyAccount.needsUpdate');
        });

        it('is usable again for a new request', async () => {
            rpc.call.mockResolvedValue({ ok: true });
            setMetadata({ agyAccountSwitchV1: confirmState });
            const screen = await renderBanner();
            await act(async () => {
                screen.findByTestId('p-agy-account-confirm')?.props.onPress();
            });
            expect(screen.findByTestId('p-agy-account-confirm')?.props.disabled).toBe(true);

            await act(async () => {
                setMetadata({ agyAccountSwitchV1: { ...confirmState, requestId: 'r2', updatedAtMs: NOW + 1 } });
            });
            expect(screen.findByTestId('p-agy-account-confirm')?.props.disabled).toBe(false);
        });
    });

    describe('the sudo note', () => {
        it('shows while sudo is unavailable on a non-default login, even with no switch going on', async () => {
            setMetadata({ agyAccountId: 'b', agyAccountSwitchV1: { v: 1, state: 'none', sudoUnavailable: true, updatedAtMs: NOW } });
            const screen = await renderBanner();
            expect(screen.findByTestId('p-agy-account-sudo')).not.toBeNull();
            expect(screen.findByTestId('p-agy-account-message')).toBeNull();
        });

        it('is gone on the default login and when the flag is false', async () => {
            setMetadata({ agyAccountId: 'default', agyAccountSwitchV1: { v: 1, state: 'none', sudoUnavailable: true, updatedAtMs: NOW } });
            expect((await renderBanner()).findByTestId('p-agy-account-sudo')).toBeNull();

            setMetadata({ agyAccountId: 'b', agyAccountSwitchV1: { v: 1, state: 'none', sudoUnavailable: false, updatedAtMs: NOW } });
            expect((await renderBanner()).findByTestId('p-agy-account-sudo')).toBeNull();
        });
    });
});
