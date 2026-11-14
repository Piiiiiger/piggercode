import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@piggercode/protocol/rpc';

const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcWithServerScopeMock,
}));

describe('machine terminal ops (server-scoped routing)', () => {
    beforeEach(() => {
        machineRpcWithServerScopeMock.mockReset();
    });

    it('routes daemon terminal ensure through server-scoped machine rpc', async () => {
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, terminalId: 't1', reused: false });
        const { machineTerminalEnsure } = await import('./machineTerminal');

        const res = await machineTerminalEnsure(
            'machine-1',
            { terminalKey: 'k', cwd: '/tmp', cols: 80, rows: 24 },
            { serverId: 'server-a' },
        );

        expect(res).toEqual({ ok: true, terminalId: 't1', reused: false });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            method: RPC_METHODS.DAEMON_TERMINAL_ENSURE,
            payload: expect.objectContaining({ terminalKey: 'k', cwd: '/tmp', cols: 80, rows: 24 }),
        }));
    });

    it('routes daemon terminal stream reads through server-scoped machine rpc', async () => {
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, terminalId: 't1', events: [], nextCursor: 1, done: false });
        const { machineTerminalStreamRead } = await import('./machineTerminal');

        const res = await machineTerminalStreamRead(
            'machine-1',
            { terminalId: 't1', cursor: 0, maxBytes: 123, maxEvents: 10 },
            { serverId: 'server-a' },
        );

        expect(res).toEqual({ ok: true, terminalId: 't1', events: [], nextCursor: 1, done: false });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            method: RPC_METHODS.DAEMON_TERMINAL_STREAM_READ,
            payload: expect.objectContaining({ terminalId: 't1', cursor: 0, maxBytes: 123, maxEvents: 10 }),
        }));
    });

    it('routes terminal restart with an initial command through server-scoped machine rpc', async () => {
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, terminalId: 't2', reused: false });
        const { machineTerminalRestart } = await import('./machineTerminal');

        const res = await machineTerminalRestart(
            'machine-1',
            { terminalKey: 'provider-login:codex', cwd: '/tmp', cols: 100, rows: 30, initialCommand: 'codex login' },
            { serverId: 'server-a' },
        );

        expect(res).toEqual({ ok: true, terminalId: 't2', reused: false });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            method: RPC_METHODS.DAEMON_TERMINAL_RESTART,
            payload: expect.objectContaining({
                terminalKey: 'provider-login:codex',
                cwd: '/tmp',
                cols: 100,
                rows: 30,
                initialCommand: 'codex login',
            }),
        }));
    });

    it('answers where a repainted screen starts, and fails for a machine too old to know the call', async () => {
        const { machineTerminalRepaint } = await import('./machineTerminal');
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, cursor: 4321 });
        await expect(machineTerminalRepaint('machine-1', { terminalId: 't1' })).resolves.toEqual({ ok: true, cursor: 4321 });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            method: RPC_METHODS.DAEMON_TERMINAL_REPAINT,
            payload: { terminalId: 't1' },
        }));

        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: false, errorCode: 'terminal_repaint_unsupported', error: 'terminal_repaint_unsupported' });
        await expect(machineTerminalRepaint('machine-1', { terminalId: 't1' })).resolves.toMatchObject({ ok: false, errorCode: 'terminal_repaint_unsupported' });

        // An older CLI has no such method and answers with an RPC error instead of a terminal result.
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ error: 'Method not found' });
        await expect(machineTerminalRepaint('machine-1', { terminalId: 't1' })).rejects.toThrow('daemon.terminal.repaint');
    });
});
