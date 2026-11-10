import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { storage } from '@/sync/domains/state/storage';

const machineRPC = vi.hoisted(() => vi.fn());
// The network boundary captures the request after real targeting and payload construction.
vi.mock('@/sync/api/session/apiSocket', () => ({ apiSocket: { machineRPC } }));

import { ensureSessionRuntimeForPendingInput, resumeSession } from './sessions';

/** A machine whose daemon starts sessions as their CLI in a terminal (CLI 0.3.19 and later). */
function createTerminalMachineFixture() {
    const machine = createMachineFixture();
    return { ...machine, metadata: { ...machine.metadata!, daemonNativeTerminalSessionsSupported: true } };
}

describe('session resume terminal settings', () => {
    const originalState = storage.getState();
    beforeEach(() => {
        machineRPC.mockReset().mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        storage.setState({
            sessions: { 'session-1': createSessionFixture() },
            machines: { 'machine-1': createTerminalMachineFixture() },
            settings: { ...settingsDefaults, sessionUseTmux: true, sessionTmuxSessionName: '', sessionTmuxIsolated: true },
        });
    });
    afterEach(() => {
        storage.getState().clearSessionResuming('session-1');
        storage.setState(originalState);
    });

    const options = {
        sessionId: 'session-1',
        machineId: 'requested-machine',
        directory: '/project',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        accountSettingsVersionHint: 0,
    } as const;

    it.each([
        ['explicit resume', resumeSession],
        ['pending input', ensureSessionRuntimeForPendingInput],
    ] as const)('honors account tmux settings for %s', async (_label, resume) => {
        expect(await resume(options)).toMatchObject({ type: 'success' });
        expect(machineRPC).toHaveBeenCalledWith('machine-1', 'spawn-happy-session', expect.objectContaining({
            type: 'resume-session',
            terminal: { mode: 'tmux', tmux: { sessionName: '', isolated: true, tmpDir: null } },
        }), expect.anything());
    });

    it('uses the resolved machine override instead of the stale requested machine', async () => {
        storage.setState({ settings: {
            ...storage.getState().settings,
            sessionTmuxByMachineId: {
                'machine-1': { useTmux: true, sessionName: ' work ', isolated: false, tmpDir: ' /tmp/work ' },
                'requested-machine': { useTmux: false, sessionName: '', isolated: true, tmpDir: null },
            },
        } });
        expect(await resumeSession(options)).toMatchObject({ type: 'success' });
        expect(machineRPC.mock.calls[0]?.[2].terminal).toEqual({
            mode: 'tmux', tmux: { sessionName: 'work', isolated: false, tmpDir: '/tmp/work' },
        });
    });

    it('reopens every session as a terminal, an old chat too, and only on a machine whose daemon starts them', async () => {
        // The session is an old chat: nothing in it or in the request asks for a terminal.
        storage.setState({ machines: { 'machine-1': createMachineFixture() } });
        expect(await resumeSession(options)).toMatchObject({ type: 'error' });
        expect(machineRPC).not.toHaveBeenCalled();
        expect(storage.getState().sessions['session-1']?.resumingAt ?? null).toBeNull();

        storage.setState({ machines: { 'machine-1': createTerminalMachineFixture() } });
        expect(await resumeSession(options)).toMatchObject({ type: 'success' });
        expect(machineRPC).toHaveBeenCalledWith('machine-1', 'spawn-happy-session', expect.objectContaining({
            type: 'resume-session',
            nativeTerminal: true,
        }), expect.anything());
    });

    it('opens a Codex chat as a terminal on its conversation, without the chat backend it ran on', async () => {
        expect(await resumeSession({
            ...options,
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            resume: 'thread-1',
        })).toMatchObject({ type: 'success' });

        const payload = machineRPC.mock.calls[0]?.[2];
        expect(payload).toMatchObject({ type: 'resume-session', resume: 'thread-1', nativeTerminal: true });
        expect(payload).not.toHaveProperty('codexBackendMode');
        expect(payload).not.toHaveProperty('agentRuntimeDescriptorV1');
    });

    it('omits terminal when the resolved machine disables tmux', async () => {
        storage.setState({ settings: {
            ...storage.getState().settings,
            sessionTmuxByMachineId: {
                'machine-1': { useTmux: false, sessionName: '', isolated: true, tmpDir: null },
            },
        } });
        expect(await resumeSession(options)).toMatchObject({ type: 'success' });
        expect(machineRPC.mock.calls[0]?.[2]).not.toHaveProperty('terminal');
    });
});
