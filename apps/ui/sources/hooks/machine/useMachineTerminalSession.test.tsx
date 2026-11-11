import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook } from '@/dev/testkit';

import { useMachineTerminalSession } from './useMachineTerminalSession';

const machineTerminalEnsureMock = vi.hoisted(() => vi.fn());
const machineTerminalRestartMock = vi.hoisted(() => vi.fn());
const machineTerminalStreamReadMock = vi.hoisted(() => vi.fn());
const machineTerminalCloseMock = vi.hoisted(() => vi.fn());
const clearTerminalOutputMock = vi.hoisted(() => vi.fn());
const surfaceClearNonceRef = vi.hoisted(() => ({ current: null as null | { current: number } }));
const hydrateTerminalRendererIfNeededMock = vi.hoisted(() => vi.fn());
const replaceSurfaceStateMock = vi.hoisted(() => vi.fn());
const setDetectedUrlMock = vi.hoisted(() => vi.fn());
const syncDetectedUrlMock = vi.hoisted(() => vi.fn());
const updateSurfaceStateMock = vi.hoisted(() => vi.fn());
const writeTerminalOutputMock = vi.hoisted(() => vi.fn());
const onInputMock = vi.hoisted(() => vi.fn());
const onResizeMock = vi.hoisted(() => vi.fn());
const onReadyMock = vi.hoisted(() => vi.fn());
const initialTerminalSize = vi.hoisted(() => ({
    cols: 80,
    rows: 24,
}));
const latestTerminalSizeRef = vi.hoisted(() => ({
    current: initialTerminalSize,
}));
// One launch object for every render: a new one each render would re-run the connection effect forever.
const agentLaunch = { kind: 'session_attach', sessionId: 'session-1' } as const;

// What the kept output says about a terminal, and whether the view shows its output from the start.
const surfaceWorld = vi.hoisted(() => ({
    cached: null as null | { terminalId: string | null; cursor: number; output: string; outputEnd: number; detectedUrl: null },
    screenWhole: true,
}));
// Stable like the real hook's callback (a new function each render would re-run the connection effect forever).
const isScreenWholeMock = vi.hoisted(() => () => surfaceWorld.screenWhole);
const terminalReaderLeaseState = vi.hoisted(() => ({
    ownerByKey: new Map<string, symbol>(),
}));

vi.mock('@/components/sessions/terminal/terminalSurfaceStateCache', () => ({
    createEmptyTerminalSurfaceState: () => ({
        terminalId: null,
        cursor: 0,
        output: '',
        outputEnd: 0,
        detectedUrl: null,
    }),
    readTerminalSurfaceState: () => surfaceWorld.cached,
}));

vi.mock('@/components/sessions/terminal/useEmbeddedTerminalTransportHandlers', () => ({
    useEmbeddedTerminalTransportHandlers: () => ({
        initialTerminalSize,
        latestTerminalSizeRef,
        onInput: onInputMock,
        onResize: onResizeMock,
        onReady: onReadyMock,
    }),
}));

vi.mock('@/components/sessions/terminal/useTerminalSurfaceState', () => ({
    useTerminalSurfaceState: (params: { clearNonceRef: { current: number } }) => ({
        ...((surfaceClearNonceRef.current = params.clearNonceRef), {}),
        detectedUrl: null,
        clearTerminalOutput: clearTerminalOutputMock,
        hydrateTerminalRendererIfNeeded: hydrateTerminalRendererIfNeededMock,
        isScreenWhole: isScreenWholeMock,
        replaceSurfaceState: replaceSurfaceStateMock,
        setDetectedUrl: setDetectedUrlMock,
        syncDetectedUrl: syncDetectedUrlMock,
        updateSurfaceState: updateSurfaceStateMock,
        writeTerminalOutput: writeTerminalOutputMock,
    }),
}));

vi.mock('@/sync/ops/machineTerminal', () => ({
    machineTerminalEnsure: (...args: unknown[]) => machineTerminalEnsureMock(...args),
    machineTerminalRestart: (...args: unknown[]) => machineTerminalRestartMock(...args),
    machineTerminalStreamRead: (...args: unknown[]) => machineTerminalStreamReadMock(...args),
    machineTerminalClose: (...args: unknown[]) => machineTerminalCloseMock(...args),
}));

vi.mock('@/components/sessions/terminal/terminalReaderLeaseRegistry', () => ({
    claimTerminalReaderLease: (terminalKey: string, ownerToken: symbol) => {
        const currentOwner = terminalReaderLeaseState.ownerByKey.get(terminalKey);
        if (currentOwner && currentOwner !== ownerToken) {
            return false;
        }
        terminalReaderLeaseState.ownerByKey.set(terminalKey, ownerToken);
        return true;
    },
    hasTerminalReaderLease: (terminalKey: string, ownerToken: symbol) =>
        terminalReaderLeaseState.ownerByKey.get(terminalKey) === ownerToken,
    releaseTerminalReaderLease: (terminalKey: string, ownerToken: symbol) => {
        if (terminalReaderLeaseState.ownerByKey.get(terminalKey) === ownerToken) {
            terminalReaderLeaseState.ownerByKey.delete(terminalKey);
        }
    },
    subscribeTerminalReaderLeaseAvailability: () => () => {},
}));

vi.mock('@/utils/timing/time', () => ({
    delay: vi.fn(async () => undefined),
}));

describe('useMachineTerminalSession', () => {
    beforeEach(() => {
        machineTerminalEnsureMock.mockReset();
        machineTerminalRestartMock.mockReset();
        machineTerminalStreamReadMock.mockReset();
        machineTerminalCloseMock.mockReset();
        terminalReaderLeaseState.ownerByKey.clear();
        surfaceWorld.cached = null;
        surfaceWorld.screenWhole = true;
        clearTerminalOutputMock.mockReset();
        hydrateTerminalRendererIfNeededMock.mockReset();
        replaceSurfaceStateMock.mockReset();
        setDetectedUrlMock.mockReset();
        syncDetectedUrlMock.mockReset();
        updateSurfaceStateMock.mockReset();
        writeTerminalOutputMock.mockReset();
        onInputMock.mockReset();
        onResizeMock.mockReset();
        onReadyMock.mockReset();

        machineTerminalEnsureMock.mockResolvedValue({
            ok: true,
            terminalId: 'terminal-1',
            reused: false,
        });
        machineTerminalRestartMock.mockResolvedValue({
            ok: true,
            terminalId: 'terminal-2',
            reused: false,
        });
        machineTerminalStreamReadMock.mockResolvedValue({
            ok: true,
            terminalId: 'terminal-1',
            events: [],
            nextCursor: 0,
            done: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('asks the machine to hold each read open, and pauses between empty answers only for a machine that answers at once', async () => {
        const { delay } = await import('@/utils/timing/time');
        const order: string[] = [];
        vi.mocked(delay).mockImplementation(async () => {
            order.push('pause');
        });
        const empty = { ok: true, terminalId: 'terminal-1', events: [], nextCursor: 0, done: false } as const;
        machineTerminalStreamReadMock
            // Held open until its wait ran out: ask again at once.
            .mockImplementationOnce(async () => {
                order.push('read');
                return { ...empty, waited: true };
            })
            // An older machine answers empty at once: pause before asking again.
            .mockImplementationOnce(async () => {
                order.push('read');
                return empty;
            })
            .mockImplementation(async () => {
                order.push('read');
                return { ...empty, done: true };
            });

        const terminalRef = { current: null };
        const launch = { kind: 'session_attach', sessionId: 'session-1' } as const;
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session:session-1:attached',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            await flushHookEffects();

            expect(machineTerminalStreamReadMock.mock.calls[0]?.[1]).toMatchObject({ waitMs: 15_000 });
            expect(machineTerminalStreamReadMock.mock.calls[0]?.[2]?.timeoutMs).toBeGreaterThan(15_000);
            expect(order.slice(0, 4)).toEqual(['read', 'read', 'pause', 'read']);
        } finally {
            vi.mocked(delay).mockImplementation(async () => undefined);
            await hook.unmount();
        }
    });

    it('shows what was typed after Clear while a read was held open', async () => {
        let answerHeldRead: (value: unknown) => void = () => undefined;
        machineTerminalStreamReadMock
            .mockImplementationOnce(() => new Promise((resolve) => {
                answerHeldRead = resolve;
            }))
            .mockResolvedValue({ ok: true, terminalId: 'terminal-1', events: [], nextCursor: 1, done: true });
        const terminalRef = { current: null };
        const launch = { kind: 'session_attach', sessionId: 'session-1' } as const;
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session:session-1:attached',
            terminalRef,
        }));
        clearTerminalOutputMock.mockImplementation(() => {
            if (surfaceClearNonceRef.current) surfaceClearNonceRef.current.current += 1;
        });
        try {
            await flushHookEffects();
            hook.getCurrent().clearTerminal();
            answerHeldRead({ ok: true, terminalId: 'terminal-1', events: [{ t: 'data', data: 'typed' }], nextCursor: 1, done: false, waited: true });
            await flushHookEffects();

            expect(writeTerminalOutputMock).toHaveBeenCalledWith('typed');
        } finally {
            await hook.unmount();
        }
    });

    it('keeps the stable terminal key on a typed session-attach request', async () => {
        const terminalRef = { current: null };
        const launch = { kind: 'session_attach', sessionId: 'session-1' } as const;
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session:session-1:attached',
            terminalRef,
        }));
        await flushHookEffects();

        expect(machineTerminalEnsureMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            terminalKey: 'session:session-1:attached',
            launch: { kind: 'session_attach', sessionId: 'session-1' },
        }));

        await hook.unmount();
    });

    it('waits for the session\'s computer while it is offline, instead of calling the session one without a computer', async () => {
        // An offline computer is no target for calls, so the session has no machine id to call until it is back.
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: null,
            cwd: null,
            launch: { kind: 'session_attach', sessionId: 'session-offline' },
            machineReachable: false,
            machineRpcTargetAvailable: false,
            terminalKey: 'terminal-key-offline-machine',
            terminalRef: { current: null },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().error).toBe('terminal_machine_waiting');
        expect(hook.getCurrent().status).not.toBe('error');

        await hook.unmount();
    });

    it('releases the reader lease after an early validation error so another pane can connect', async () => {
        const terminalRef = { current: null };
        const failed = await renderHook(() => useMachineTerminalSession({
            machineId: null,
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-validation',
            terminalRef,
        }));
        await flushHookEffects();

        expect(failed.getCurrent().error).toBe('terminal_missing_machine_target');

        const next = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-validation',
            terminalRef,
        }));
        await flushHookEffects();

        expect(machineTerminalEnsureMock).toHaveBeenCalledTimes(1);

        await failed.unmount();
        await next.unmount();
    });

    it('reconnects by itself when the connection drops during a read, instead of showing an error', async () => {
        const terminalRef = { current: null };
        machineTerminalStreamReadMock.mockRejectedValueOnce(new Error('socket has been disconnected'));

        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-socket-drop',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            expect(hook.getCurrent().error).toBeNull();
            await vi.waitFor(async () => {
                await flushHookEffects();
                expect(machineTerminalEnsureMock).toHaveBeenCalledTimes(2);
            }, { timeout: 3_000 });
        } finally {
            await hook.unmount();
        }
    });

    it('releases the reader lease after a fatal RPC failure so another pane can retry', async () => {
        const terminalRef = { current: null };
        machineTerminalEnsureMock.mockRejectedValueOnce(new Error('rpc exploded'));

        const failed = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-rpc-error',
            terminalRef,
        }));
        await flushHookEffects();

        expect(failed.getCurrent().error).toBe('rpc exploded');

        const next = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-rpc-error',
            terminalRef,
        }));
        await flushHookEffects();

        expect(machineTerminalEnsureMock).toHaveBeenCalledTimes(2);

        await failed.unmount();
        await next.unmount();
    });

    it.each([
        {
            name: 'the stream finishes with done',
            firstReadResult: {
                ok: true,
                terminalId: 'terminal-1',
                events: [],
                nextCursor: 0,
                done: true,
            },
        },
        {
            name: 'the stream emits exit',
            firstReadResult: {
                ok: true,
                terminalId: 'terminal-1',
                events: [{ t: 'exit', exitCode: 0 }],
                nextCursor: 0,
                done: false,
            },
        },
        {
            name: 'the stream fails with a non-recoverable error',
            firstReadResult: {
                ok: false,
                errorCode: 'terminal_session_missing',
            },
        },
    ])('releases the reader lease after $name so another pane can reconnect', async ({ firstReadResult }) => {
        const terminalRef = { current: null };
        machineTerminalStreamReadMock
            .mockResolvedValueOnce(firstReadResult)
            .mockResolvedValue({
                ok: true,
                terminalId: 'terminal-2',
                events: [],
                nextCursor: 0,
                done: true,
            });

        const finished = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-stream-release',
            terminalRef,
        }));
        await flushHookEffects();

        const next = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-stream-release',
            terminalRef,
        }));
        await flushHookEffects();

        expect(machineTerminalEnsureMock).toHaveBeenCalledTimes(2);

        await finished.unmount();
        await next.unmount();
    });
    it('waits for a machine this app sees as offline instead of failing, and connects once it is back', async () => {
        const terminalRef = { current: null };
        const launch = { kind: 'session_attach', sessionId: 'session-1' } as const;
        const hook = await renderHook((reachable: boolean) => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch,
            machineReachable: reachable,
            machineRpcTargetAvailable: true,
            terminalKey: 'session-attach:waiting',
            terminalRef,
        }), { initialProps: false });
        try {
            await flushHookEffects();
            expect(hook.getCurrent().status).toBe('connecting');
            expect(hook.getCurrent().error).toBe('terminal_machine_waiting');
            expect(machineTerminalEnsureMock).not.toHaveBeenCalled();

            await hook.rerender(true);
            await flushHookEffects();
            expect(machineTerminalEnsureMock).toHaveBeenCalledTimes(1);
            expect(hook.getCurrent().error).toBeNull();
        } finally {
            await hook.unmount();
        }
    });

    it('keeps reconnecting for as long as this app is offline, instead of giving up with an error', async () => {
        vi.useFakeTimers();
        const terminalRef = { current: null };
        // Offline, nothing reaches the machine: connecting fails as well as reading.
        const offline = () => Promise.reject(new Error('socket has been disconnected'));
        for (let i = 0; i < 9; i += 1) machineTerminalEnsureMock.mockImplementationOnce(offline);
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: '/repo',
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'terminal-key-offline',
            terminalRef,
        }));
        try {
            for (let i = 0; i < 12; i += 1) {
                await vi.advanceTimersByTimeAsync(5_000);
                expect(hook.getCurrent().status).not.toBe('error');
            }
            // Back online: the tenth attempt connects.
            expect(machineTerminalEnsureMock.mock.calls.length).toBeGreaterThanOrEqual(10);
        } finally {
            await hook.unmount();
            vi.useRealTimers();
        }
    });

    it('attaches an agent terminal again when output was dropped before the view read it', async () => {
        const terminalRef = { current: null };
        machineTerminalStreamReadMock.mockResolvedValueOnce({
            ok: true,
            terminalId: 'terminal-1',
            events: [{ t: 'gap', droppedBefore: 120 }, { t: 'data', data: '\x1b[27;54H7' }],
            nextCursor: 500,
            done: false,
        });
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch: agentLaunch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session-attach:gap',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            await flushHookEffects();
            expect(machineTerminalRestartMock).toHaveBeenCalledTimes(1);
            expect(writeTerminalOutputMock).not.toHaveBeenCalledWith('\r\n[Output truncated]\r\n');
            expect(writeTerminalOutputMock).not.toHaveBeenCalledWith('\x1b[27;54H7');
        } finally {
            await hook.unmount();
        }
    });

    it('attaches an agent terminal again when a new view could be given only the end of its output', async () => {
        const terminalRef = { current: null };
        // The kept output of this attach no longer reaches back to its start.
        surfaceWorld.cached = { terminalId: 'terminal-1', cursor: 4_000, output: 'tail of the output', outputEnd: 90_000, detectedUrl: null };
        surfaceWorld.screenWhole = false;
        machineTerminalEnsureMock.mockResolvedValueOnce({ ok: true, terminalId: 'terminal-1', reused: true });
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch: agentLaunch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session-attach:reopened',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            await flushHookEffects();
            expect(machineTerminalRestartMock).toHaveBeenCalledTimes(1);
        } finally {
            await hook.unmount();
        }
    });
    it('has an agent terminal attached afresh when a second view of it could be given only the end of its output', async () => {
        const terminalRef = { current: null };
        // Another view already reads this terminal.
        terminalReaderLeaseState.ownerByKey.set('session-attach:second-view', Symbol('other view'));
        surfaceWorld.cached = { terminalId: 'terminal-1', cursor: 4_000, output: 'tail of the output', outputEnd: 90_000, detectedUrl: null };
        surfaceWorld.screenWhole = false;
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch: agentLaunch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session-attach:second-view',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            expect(machineTerminalEnsureMock).not.toHaveBeenCalled();
            expect(machineTerminalRestartMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
                terminalKey: 'session-attach:second-view',
                launch: { kind: 'session_attach', sessionId: 'session-1' },
            }));
        } finally {
            await hook.unmount();
        }
    });
    it('keeps the screen in sight while it connects again after a dropped connection', async () => {
        const terminalRef = { current: null };
        machineTerminalStreamReadMock
            .mockResolvedValueOnce({ ok: true, terminalId: 'terminal-1', events: [{ t: 'data', data: '> ' }], nextCursor: 1, done: false })
            .mockRejectedValueOnce(new Error('socket has been disconnected'));
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch: agentLaunch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session-attach:reconnecting',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            await flushHookEffects();
            expect(hook.getCurrent().status).toBe('reconnecting');
            expect(hook.getCurrent().error).toBeNull();
        } finally {
            await hook.unmount();
        }
    });

    it('puts only the login links of an agent terminal in the link bar', async () => {
        const terminalRef = { current: null };
        const login = { t: 'url', url: 'https://claude.ai/oauth/authorize?code=1', kind: 'auth' } as const;
        machineTerminalStreamReadMock.mockResolvedValueOnce({
            ok: true,
            terminalId: 'terminal-1',
            events: [{ t: 'url', url: 'https://example.com/docs', kind: 'generic' }, login],
            nextCursor: 2,
            done: false,
        });
        const hook = await renderHook(() => useMachineTerminalSession({
            machineId: 'machine-1',
            cwd: null,
            launch: agentLaunch,
            machineReachable: true,
            machineRpcTargetAvailable: true,
            terminalKey: 'session-attach:links',
            terminalRef,
        }));
        try {
            await flushHookEffects();
            await flushHookEffects();
            expect(syncDetectedUrlMock.mock.calls).toEqual([[login]]);
        } finally {
            await hook.unmount();
        }
    });
});
