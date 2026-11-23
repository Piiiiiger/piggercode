import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { describe, expect, it, vi } from 'vitest';

import type { RpcHandler, RpcHandlerRegistrar } from '../rpc/types';
import {
  registerMachineAgyAccountUsageRpcHandlers,
  type RegisterMachineAgyAccountUsageRpcHandlersDeps,
} from './rpcHandlers.agyAccountUsage';

const ACCOUNT = {
  accountId: 'default',
  email: 'someone@example.com',
  planTier: 'pro',
  observedAtMs: 1_000,
  meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: 2_000 }],
};
const NO_READING = { accountId: 'default', email: null, planTier: null, observedAtMs: null, meters: [] };

function readThrough(deps: RegisterMachineAgyAccountUsageRpcHandlersDeps, request: unknown = {}) {
  const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
  registerMachineAgyAccountUsageRpcHandlers({
    rpcHandlerManager: {
      registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
        handlers.set(method, async (raw: unknown) => await handler(raw as TRequest));
      },
    } satisfies RpcHandlerRegistrar,
    deps,
  });
  return handlers.get(RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ)!(request);
}

describe('registerMachineAgyAccountUsageRpcHandlers', () => {
  it('sends the readings of an end-to-end encrypted machine, and starts nothing', async () => {
    const refreshAgyAccountUsage = vi.fn(async () => true);
    await expect(readThrough({
      readAgyAccountUsage: async () => [ACCOUNT],
      refreshAgyAccountUsage,
      isMachineEndToEndEncrypted: () => true,
    })).resolves.toEqual({ ok: true, accounts: [ACCOUNT] });
    expect(refreshAgyAccountUsage).not.toHaveBeenCalled();
  });

  it('reads that login at a press of refresh, and says whether it read', async () => {
    const refreshAgyAccountUsage = vi.fn(async (_accountId: string) => true);
    const deps = {
      readAgyAccountUsage: async () => [ACCOUNT],
      refreshAgyAccountUsage,
      isMachineEndToEndEncrypted: () => true,
    };
    await expect(readThrough(deps, { refreshAccountId: 'default' }))
      .resolves.toEqual({ ok: true, accounts: [ACCOUNT], refreshed: true });
    expect(refreshAgyAccountUsage).toHaveBeenCalledWith('default');

    refreshAgyAccountUsage.mockRejectedValueOnce(new Error('agy failed'));
    await expect(readThrough(deps, { refreshAccountId: 'default' }))
      .resolves.toEqual({ ok: true, accounts: [ACCOUNT], refreshed: false });
  });

  it('keeps the readings of a plain machine off the relay, and starts nothing there', async () => {
    const refreshAgyAccountUsage = vi.fn(async () => true);
    const response = await readThrough({
      readAgyAccountUsage: async () => [ACCOUNT],
      refreshAgyAccountUsage,
      isMachineEndToEndEncrypted: () => false,
    }, { refreshAccountId: 'default' });
    expect(response).toEqual({ ok: false, errorCode: 'agy_account_usage_requires_encryption' });
    expect(JSON.stringify(response)).not.toContain('someone@example.com');
    expect(refreshAgyAccountUsage).not.toHaveBeenCalled();
  });

  it('does not send readings when the machine\'s encryption is not known', async () => {
    await expect(readThrough({ readAgyAccountUsage: async () => [ACCOUNT] })).resolves.toEqual({
      ok: false,
      errorCode: 'agy_account_usage_requires_encryption',
    });
  });

  it('reports a failed read by its code, without the local path in the error', async () => {
    await expect(readThrough({
      readAgyAccountUsage: async () => {
        throw new Error("EACCES: permission denied, open '/home/someone/usage.json'");
      },
      isMachineEndToEndEncrypted: () => false,
    })).resolves.toEqual({ ok: false, errorCode: 'agy_account_usage_read_failed' });
  });

  it('has nothing to point at on a plain machine with no readings', async () => {
    await expect(readThrough({
      readAgyAccountUsage: async () => [NO_READING],
      isMachineEndToEndEncrypted: () => false,
    })).resolves.toEqual({ ok: true, accounts: [] });
  });

  it('refuses a malformed request', async () => {
    await expect(readThrough({
      readAgyAccountUsage: async () => [ACCOUNT],
      isMachineEndToEndEncrypted: () => true,
    }, { refreshAccountId: 7 })).resolves.toEqual({ ok: false, errorCode: 'invalid_parameters' });
  });
});
