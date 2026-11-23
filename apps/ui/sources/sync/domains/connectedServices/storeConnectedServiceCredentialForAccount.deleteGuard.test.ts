import { getServerFetchUrl } from '@/dev/testkit/mocks/serverFetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { ConnectedServiceId } from '@piggercode/protocol';

const machineRpcMock = vi.hoisted(() => vi.fn());
// The sync engine's one-shot settings read (its own tests cover reading and opening the settings):
// `managingMachineId` is what the server has, whatever this client cached.
const serverSettings = vi.hoisted(() => ({ managingMachineId: null as string | null, readFails: false }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
  machineRpcWithServerScope: machineRpcMock,
}));

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
  getSyncSingleton: () => ({
    updateAccountSettingOnce: async (update: { decide: (current: unknown) => unknown }) => {
      if (serverSettings.readFails) throw new Error('settings could not be read');
      await update.decide({ v: 1, managingMachineId: serverSettings.managingMachineId, poolsPaused: false });
    },
  }),
}));

const credentials: AuthCredentials = { token: 't', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
const REVISION = 'csr_0123456789ABCDEFGHJKMNPQRS';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

beforeEach(() => {
  machineRpcMock.mockReset();
  serverSettings.readFails = false;
});

async function setup(managingMachineId: string | null, cachedManagingMachineId: string | null = managingMachineId) {
  serverSettings.managingMachineId = managingMachineId;
  vi.doMock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'test', serverUrl: 'https://api.example.test', kind: 'custom', generation: 1 }),
  }));
  vi.doMock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getCachedReadyServerFeatures: () => ({ capabilities: { connectedServices: { credentialDelete: { revisionGuard: true } } } }),
    getReadyServerFeatures: vi.fn(async () => null),
  }));
  let deletes = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getServerFetchUrl(input).pathname;
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/health') || url.endsWith('/v1/auth/ping')) return new Response('', { status: 200 });
    if (url.endsWith('/v1/account/encryption')) return new Response(JSON.stringify({ mode: 'plain', updatedAt: 1 }), { status: 200 });
    if (method === 'DELETE' && url.endsWith('/credential')) {
      deletes += 1;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
  }) as unknown as typeof fetch);

  const { getStorage } = await import('@/sync/domains/state/storageStore');
  getStorage().getState().applySettingsLocal({
    connectedServicesManagementV1: { v: 1, managingMachineId: cachedManagingMachineId, poolsPaused: false },
  });
  const { deleteConnectedServiceCredentialForAccount } = await import('./storeConnectedServiceCredentialForAccount');
  const remove = (serviceId: ConnectedServiceId) => deleteConnectedServiceCredentialForAccount(credentials, {
    serviceId,
    profileId: 'work',
    expectedCredentialRevision: REVISION,
  });
  return { remove, deleteCount: () => deletes };
}

describe('deleteConnectedServiceCredentialForAccount subscription-login guard', () => {
  it('refuses the delete while no machine manages subscription logins: nothing can confirm it is unused', async () => {
    const { remove, deleteCount } = await setup(null);
    await expect(remove('openai-codex')).rejects.toThrow();
    expect(machineRpcMock).not.toHaveBeenCalled();
    expect(deleteCount()).toBe(0);
  });

  it('asks the managing machine and deletes only when the login is free', async () => {
    machineRpcMock.mockResolvedValueOnce({ status: 'free' });
    const { remove, deleteCount } = await setup('vm-1');
    await expect(remove('openai-codex')).resolves.toBeUndefined();
    expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'vm-1',
      method: 'daemon.connectedServices.loginUse',
      payload: { serviceId: 'openai-codex', profileId: 'work' },
    }));
    expect(deleteCount()).toBe(1);
  });

  it.each([
    ['terminal', { status: 'in_use', reason: 'terminal' }],
    ['refreshing', { status: 'in_use', reason: 'refreshing' }],
    ['rotation_not_read_back', { status: 'in_use', reason: 'rotation_not_read_back' }],
    ['unknown', { status: 'unknown', reason: 'not_managing_machine' }],
    ['unreadable reply', { nope: true }],
  ])('refuses the delete on %s', async (_label, reply) => {
    machineRpcMock.mockResolvedValueOnce(reply);
    const { remove, deleteCount } = await setup('vm-1');
    await expect(remove('claude-subscription')).rejects.toThrow();
    expect(deleteCount()).toBe(0);
  });

  it('refuses the delete when the managing machine cannot be reached', async () => {
    machineRpcMock.mockRejectedValueOnce(new Error('Socket not connected'));
    const { remove, deleteCount } = await setup('vm-1');
    await expect(remove('openai-codex')).rejects.toThrow();
    expect(deleteCount()).toBe(0);
  });

  it('asks the machine the server names, not the one this client cached', async () => {
    const { remove, deleteCount } = await setup('vm-1', null);
    machineRpcMock.mockResolvedValueOnce({ status: 'in_use', reason: 'terminal' });
    await expect(remove('openai-codex')).rejects.toThrow();
    expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'vm-1' }));
    expect(deleteCount()).toBe(0);
  });

  it('refuses the delete when the settings cannot be read', async () => {
    const { remove, deleteCount } = await setup('vm-1');
    serverSettings.readFails = true;
    await expect(remove('claude-subscription')).rejects.toThrow();
    expect(machineRpcMock).not.toHaveBeenCalled();
    expect(deleteCount()).toBe(0);
  });

  it('does not ask for services that are not subscription logins', async () => {
    const { remove, deleteCount } = await setup('vm-1');
    await expect(remove('anthropic' as ConnectedServiceId)).resolves.toBeUndefined();
    expect(machineRpcMock).not.toHaveBeenCalled();
    expect(deleteCount()).toBe(1);
  });
});
