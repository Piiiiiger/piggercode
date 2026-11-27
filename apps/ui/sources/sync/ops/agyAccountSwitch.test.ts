import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: rpc.call,
}));

import { confirmAgyAccountSwitch } from './agyAccountSwitch';

describe('confirmAgyAccountSwitch', () => {
    beforeEach(() => rpc.call.mockReset());

    it('calls the session method with the request id', async () => {
        rpc.call.mockResolvedValue({ ok: true });
        await expect(confirmAgyAccountSwitch({ sessionId: 's1', requestId: 'r1' })).resolves.toBe('done');
        expect(rpc.call).toHaveBeenCalledWith({
            sessionId: 's1',
            method: 'agy.accountSwitch.confirm',
            payload: { requestId: 'r1' },
        });
    });

    it.each([
        [{ ok: false, reason: 'no_request' }, 'stale'],
        [{ ok: false, reason: 'stale_request' }, 'stale'],
        [{ ok: false, reason: 'not_supported' }, 'unsupported'],
        [{ ok: false, reason: 'other' }, 'failed'],
        ['garbage', 'failed'],
    ])('maps the answer %j to %s', async (answer, expected) => {
        rpc.call.mockResolvedValue(answer);
        await expect(confirmAgyAccountSwitch({ sessionId: 's1', requestId: 'r1' })).resolves.toBe(expected);
    });

    it('reads an unknown method as an old CLI and any other error as a failure to retry', async () => {
        rpc.call.mockRejectedValueOnce(Object.assign(new Error('x'), { rpcErrorCode: 'RPC_METHOD_NOT_AVAILABLE' }));
        await expect(confirmAgyAccountSwitch({ sessionId: 's1', requestId: 'r1' })).resolves.toBe('unsupported');
        rpc.call.mockRejectedValueOnce(new Error('offline'));
        await expect(confirmAgyAccountSwitch({ sessionId: 's1', requestId: 'r1' })).resolves.toBe('failed');
    });
});
