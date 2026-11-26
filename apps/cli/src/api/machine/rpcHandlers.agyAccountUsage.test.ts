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

function loginThrough(deps: RegisterMachineAgyAccountUsageRpcHandlersDeps, request: unknown) {
  const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
  registerMachineAgyAccountUsageRpcHandlers({
    rpcHandlerManager: {
      registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
        handlers.set(method, async (raw: unknown) => await handler(raw as TRequest));
      },
    } satisfies RpcHandlerRegistrar,
    deps,
  });
  return handlers.get(RPC_METHODS.DAEMON_AGY_ACCOUNT_LOGIN)!(request);
}

const SIGN_IN_URL = 'https://accounts.google.com/o/oauth2/auth?state=s1';

function fakeLogins(overrides: Partial<NonNullable<RegisterMachineAgyAccountUsageRpcHandlersDeps['agyAccountLogins']>> = {}) {
  return {
    start: vi.fn(async () => ({ ok: true as const, loginId: 'l1', accountId: 'a', url: SIGN_IN_URL })),
    submit: vi.fn(async (_loginId: string, _input: string) => ({ ok: true as const, accountId: 'a' })),
    cancel: vi.fn(async (_loginId: string) => {}),
    remove: vi.fn(async (_accountId: string) => ({ ok: true as const })),
    dispose: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('adding a Google login to agy', () => {
  it('runs the login on an end-to-end encrypted machine, and on no other', async () => {
    const agyAccountLogins = fakeLogins();
    const encrypted = { agyAccountLogins, isMachineEndToEndEncrypted: () => true };

    await expect(loginThrough(encrypted, { action: 'start' }))
      .resolves.toEqual({ ok: true, action: 'start', loginId: 'l1', accountId: 'a', url: SIGN_IN_URL });
    await expect(loginThrough(encrypted, { action: 'submit', loginId: 'l1', code: '4/0Abc' }))
      .resolves.toEqual({ ok: true, action: 'submit', accountId: 'a' });
    expect(agyAccountLogins.submit).toHaveBeenCalledWith('l1', '4/0Abc');
    await expect(loginThrough(encrypted, { action: 'cancel', loginId: 'l1' })).resolves.toEqual({ ok: true, action: 'cancel' });
    await expect(loginThrough(encrypted, { action: 'remove', accountId: 'b' })).resolves.toEqual({ ok: true, action: 'remove' });
    expect(agyAccountLogins.remove).toHaveBeenCalledWith('b');

    const plainLogins = fakeLogins();
    await expect(loginThrough({ agyAccountLogins: plainLogins, isMachineEndToEndEncrypted: () => false }, { action: 'start' }))
      .resolves.toEqual({ ok: false, errorCode: 'agy_account_login_requires_encryption' });
    expect(plainLogins.start).not.toHaveBeenCalled();
  });

  it('says when a sign-in replaced the login of the same Google account', async () => {
    const agyAccountLogins = fakeLogins({ submit: vi.fn(async () => ({ ok: true as const, accountId: 'a', replaced: true as const })) });
    await expect(loginThrough({ agyAccountLogins, isMachineEndToEndEncrypted: () => true }, { action: 'submit', loginId: 'l1', code: '4/0Abc' }))
      .resolves.toEqual({ ok: true, action: 'submit', accountId: 'a', replaced: true });
  });

  it('answers a failure by its code only, and says when it cannot add logins', async () => {
    const failing = fakeLogins({ start: vi.fn(async () => { throw new Error('/home/someone/.piggercode failed'); }) });
    await expect(loginThrough({ agyAccountLogins: failing, isMachineEndToEndEncrypted: () => true }, { action: 'start' }))
      .resolves.toEqual({ ok: false, errorCode: 'login_failed' });
    await expect(loginThrough({ agyAccountLogins: fakeLogins(), isMachineEndToEndEncrypted: () => true }, { action: 'submit', loginId: 'l1' }))
      .resolves.toEqual({ ok: false, errorCode: 'invalid_parameters' });
    await expect(loginThrough({ isMachineEndToEndEncrypted: () => true }, { action: 'start' }))
      .resolves.toEqual({ ok: false, errorCode: 'agy_account_login_unavailable' });
  });
});
