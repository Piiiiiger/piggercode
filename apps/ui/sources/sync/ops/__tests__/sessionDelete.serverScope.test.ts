import { matchServerFetchUrl } from '@/dev/testkit/mocks/serverFetch';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequest, mockResolveContext, mockRuntimeFetch, mockMachineRpc, mockStorageState } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockMachineRpc: vi.fn(),
  mockResolveContext: vi.fn(),
  mockRuntimeFetch: vi.fn(),
  mockStorageState: {
    sessions: {},
    sessionListViewDataByServerId: {},
    applySessions: vi.fn(),
  } as {
    sessions: Record<string, unknown>;
    sessionListViewDataByServerId: Record<string, unknown>;
    applySessions: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('../../api/session/apiSocket', () => ({
  apiSocket: {
    request: mockRequest,
  },
}));

vi.mock('../../runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext', () => ({
  resolveServerScopedSessionContext: mockResolveContext,
}));

vi.mock('@/utils/system/runtimeFetch', () => ({
  runtimeFetch: mockRuntimeFetch,
}));

vi.mock('../../runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
  machineRpcWithServerScope: mockMachineRpc,
}));

vi.mock('../../domains/state/storage', () => ({
  storage: {
    getState: () => mockStorageState,
  },
}));

import { sessionDelete, sessionDeleteWithServerScope } from '../../ops';

function makeResponse(opts: Readonly<{ ok: boolean; status?: number; json?: unknown; text?: string }>) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => opts.json ?? {},
    text: async () => opts.text ?? '',
    headers: new Map(),
  } as any;
}

describe('sessionDeleteWithServerScope', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockResolveContext.mockReset();
    mockRuntimeFetch.mockReset();
    mockMachineRpc.mockReset();
    mockStorageState.sessions = {};
    mockStorageState.sessionListViewDataByServerId = {};
    mockStorageState.applySessions.mockReset();
  });

  it('uses active apiSocket.request when scope is active', async () => {
    mockResolveContext.mockResolvedValue({
      scope: 'active',
      targetServerUrl: 'https://active.example',
      targetServerId: 'server-a',
      token: 'tok',
      timeoutMs: 1000,
      encryption: null,
    });
    mockRequest.mockResolvedValue(makeResponse({ ok: true }));

    const res = await sessionDeleteWithServerScope('sid-1', { serverId: 'server-a' });
    expect(res).toEqual({ success: true });
    expect(mockRequest).toHaveBeenCalledWith('/v1/sessions/sid-1', { method: 'DELETE' });
    expect(mockRuntimeFetch).not.toHaveBeenCalled();
    expect(mockMachineRpc).not.toHaveBeenCalled();
  });

  it('uses runtimeFetch with the scoped server URL and bearer token when scope is not active', async () => {
    mockResolveContext.mockResolvedValue({
      scope: 'scoped',
      targetServerUrl: 'https://scoped.example',
      targetServerId: 'server-b',
      token: 'tok_scoped',
      timeoutMs: 1000,
      encryption: null,
    });
    mockRuntimeFetch.mockResolvedValue(makeResponse({ ok: true }));

    const res = await sessionDeleteWithServerScope('sid-2', { serverId: 'server-b' });
    expect(res).toEqual({ success: true });
    const deleteCall = mockRuntimeFetch.mock.calls.find(([url, init]) => (
      matchServerFetchUrl('https://scoped.example/v1/sessions/sid-2').asymmetricMatch(url)
      && (init as RequestInit | undefined)?.method === 'DELETE'
    ));
    expect(deleteCall).toBeTruthy();
    expect(new Headers((deleteCall?.[1] as RequestInit | undefined)?.headers).get('Authorization'))
      .toBe('Bearer tok_scoped');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('sessionDelete defaults to the preferred owner server from local cache', async () => {
    mockStorageState.sessions = {
      'sid-owned': {
        serverId: 'server-owned',
      },
    };
    mockResolveContext.mockResolvedValue({
      scope: 'active',
      targetServerUrl: 'https://active.example',
      targetServerId: 'server-owned',
      token: 'tok',
      timeoutMs: 1000,
      encryption: null,
    });
    mockRequest.mockResolvedValue(makeResponse({ ok: true }));

    const res = await sessionDelete('sid-owned');

    expect(res).toEqual({ success: true });
    expect(mockResolveContext).toHaveBeenCalledWith({ serverId: 'server-owned' });
    expect(mockRequest).toHaveBeenCalledWith('/v1/sessions/sid-owned', { method: 'DELETE' });
  });

  describe('sessions linked to a provider session', () => {
    const providerSource = { kind: 'codexHome', home: 'user' } as const;

    beforeEach(() => {
      mockStorageState.sessions = {
        'sid-direct': {
          metadata: {
            directSessionV1: {
              v: 1,
              providerId: 'codex',
              machineId: 'machine-1',
              remoteSessionId: 'codex-thread-1',
              source: providerSource,
            },
          },
        },
      };
      mockResolveContext.mockResolvedValue({
        scope: 'active',
        targetServerUrl: 'https://active.example',
        targetServerId: 'server-a',
        token: 'tok',
        timeoutMs: 1000,
        encryption: null,
      });
      mockRequest.mockResolvedValue(makeResponse({ ok: true }));
    });

    it('deletes the provider session on its machine before deleting the Happier session', async () => {
      mockMachineRpc.mockResolvedValue({ ok: true, deleted: true });

      const res = await sessionDeleteWithServerScope('sid-direct', { serverId: 'server-a' });

      expect(res).toEqual({ success: true });
      expect(mockMachineRpc).toHaveBeenCalledWith(expect.objectContaining({
        machineId: 'machine-1',
        serverId: 'server-a',
        method: RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_DELETE,
        payload: { machineId: 'machine-1', providerId: 'codex', source: providerSource, remoteSessionId: 'codex-thread-1' },
      }));
      expect(mockRequest).toHaveBeenCalledWith('/v1/sessions/sid-direct', { method: 'DELETE' });
      expect(mockMachineRpc.mock.invocationCallOrder[0]).toBeLessThan(mockRequest.mock.invocationCallOrder[0]!);
    });

    it('keeps the Happier session when the machine reports that its copy was not deleted', async () => {
      mockMachineRpc.mockResolvedValue({ ok: false, errorCode: 'machine_offline', error: 'Machine is offline' });

      const res = await sessionDeleteWithServerScope('sid-direct', { serverId: 'server-a' });

      expect(res).toEqual({ success: false, message: 'Machine is offline' });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('keeps the Happier session when the machine cannot be reached', async () => {
      mockMachineRpc.mockRejectedValue(new Error('RPC timed out'));

      const res = await sessionDeleteWithServerScope('sid-direct', { serverId: 'server-a' });

      expect(res).toEqual({ success: false, message: 'RPC timed out' });
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it.each(['provider_unavailable', 'invalid_request'] as const)(
      'still deletes the Happier session when the provider answers %s for its copy',
      async (errorCode) => {
        mockMachineRpc.mockResolvedValue({ ok: false, errorCode, error: 'cannot delete this provider session' });

        const res = await sessionDeleteWithServerScope('sid-direct', { serverId: 'server-a' });

        expect(res).toEqual({ success: true });
        expect(mockRequest).toHaveBeenCalledWith('/v1/sessions/sid-direct', { method: 'DELETE' });
      },
    );
  });
});
