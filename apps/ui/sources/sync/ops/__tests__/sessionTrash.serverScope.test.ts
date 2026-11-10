import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequest, mockResolveContext, mockMachineRpc, mockStorageState } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockMachineRpc: vi.fn(),
  mockResolveContext: vi.fn(),
  mockStorageState: {
    sessions: {},
    sessionListViewDataByServerId: {},
    applySessions: vi.fn(),
  } as { sessions: Record<string, unknown>; sessionListViewDataByServerId: Record<string, unknown>; applySessions: ReturnType<typeof vi.fn> },
}));

vi.mock('../../api/session/apiSocket', () => ({ apiSocket: { request: mockRequest } }));
vi.mock('../../runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext', () => ({
  resolveServerScopedSessionContext: mockResolveContext,
}));
vi.mock('../../runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
  machineRpcWithServerScope: mockMachineRpc,
}));
vi.mock('../../domains/state/storage', () => ({ storage: { getState: () => mockStorageState } }));

import { sessionRestoreFromTrashWithServerScope, sessionTrashWithServerScope } from '../../ops';

function makeResponse(opts: Readonly<{ ok: boolean; status?: number; text?: string }>) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => ({}),
    text: async () => opts.text ?? '',
    headers: new Map(),
  } as any;
}

/** The API socket hands the response to the request's consumer callback when it is given one. */
function respondWith(response: unknown, byIdResponse: unknown = makeResponse({ ok: true })) {
  mockRequest.mockImplementation(async (path: string, _init: unknown, consume?: (r: unknown) => Promise<unknown>) => {
    // The by-id read that settles an ambiguous outcome answers separately from the trash/restore POST.
    const answer = path === '/v2/sessions/sid-direct' ? byIdResponse : response;
    return consume ? await consume(answer) : answer;
  });
}

const providerSource = { kind: 'codexHome', home: 'user' } as const;
const linkedMetadata = {
  directSessionV1: { v: 1, providerId: 'codex', machineId: 'machine-1', remoteSessionId: 'thread-1', source: providerSource },
};

describe('session trash with a linked provider copy', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockResolveContext.mockReset();
    mockMachineRpc.mockReset();
    mockStorageState.sessions = { 'sid-direct': { metadata: linkedMetadata } };
    mockResolveContext.mockResolvedValue({
      scope: 'active', targetServerUrl: 'https://active.example', targetServerId: 'server-a', token: 'tok', timeoutMs: 1000, encryption: null,
    });
  });

  const methods = () => mockMachineRpc.mock.calls.map((call) => call[0].method);

  it('moves the machine copy first, then trashes on the server', async () => {
    mockMachineRpc.mockResolvedValue({ ok: true, trashed: true });
    respondWith(makeResponse({ ok: true }));

    expect(await sessionTrashWithServerScope('sid-direct', { serverId: 'server-a' })).toEqual({ success: true });

    expect(methods()).toEqual([RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_TRASH]);
    expect(mockRequest).toHaveBeenCalledWith('/v2/sessions/sid-direct/trash', expect.objectContaining({ method: 'POST' }), expect.any(Function));
  });

  it('puts the machine copy back when the server refused and the session is still listed', async () => {
    mockMachineRpc.mockResolvedValue({ ok: true, trashed: true });
    respondWith(makeResponse({ ok: false, status: 500, text: 'server down' }), makeResponse({ ok: true }));

    expect(await sessionTrashWithServerScope('sid-direct', { serverId: 'server-a' })).toEqual({ success: false, message: 'server down' });

    expect(methods()).toEqual([
      RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_TRASH,
      RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_RESTORE,
    ]);
  });

  it('keeps the machine entry and reports success when the failed trash request had in fact committed', async () => {
    mockMachineRpc.mockResolvedValue({ ok: true, trashed: true });
    respondWith(makeResponse({ ok: false, status: 500, text: 'reply lost' }), makeResponse({ ok: false, status: 404 }));

    expect(await sessionTrashWithServerScope('sid-direct', { serverId: 'server-a' })).toEqual({ success: true });
    expect(methods()).toEqual([RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_TRASH]);
  });

  it('keeps the machine entry and says the result is pending when the server cannot be asked', async () => {
    mockMachineRpc.mockResolvedValue({ ok: true, trashed: true });
    respondWith(makeResponse({ ok: false, status: 500, text: 'down' }), makeResponse({ ok: false, status: 503 }));

    const res = await sessionTrashWithServerScope('sid-direct', { serverId: 'server-a' });

    expect(res.success).toBe(false);
    expect(res.message).toContain('could not be confirmed');
    expect(methods()).toEqual([RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_TRASH]);
  });

  it('puts the machine copy back into the trash when restoring failed and the session is still trashed', async () => {
    mockMachineRpc.mockResolvedValue({ ok: true, restored: true });
    respondWith(makeResponse({ ok: false, status: 500, text: 'server down' }), makeResponse({ ok: false, status: 404 }));

    const res = await sessionRestoreFromTrashWithServerScope('sid-direct', { serverId: 'server-a', metadata: linkedMetadata });

    expect(res).toEqual({ success: false, message: 'server down' });
    expect(methods()).toEqual([
      RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_RESTORE,
      RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_TRASH,
    ]);
  });

  it('reports success without touching the machine when a failed restore had in fact committed', async () => {
    mockMachineRpc.mockResolvedValue({ ok: true, restored: true });
    respondWith(makeResponse({ ok: false, status: 500, text: 'reply lost' }), makeResponse({ ok: true }));

    expect(await sessionRestoreFromTrashWithServerScope('sid-direct', { serverId: 'server-a', metadata: linkedMetadata })).toEqual({ success: true });
    expect(methods()).toEqual([RPC_METHODS.DAEMON_DIRECT_SESSION_CANDIDATE_RESTORE]);
  });

  it.each([
    ['a live runner', { ok: false, errorCode: 'provider_unavailable', error: 'This session is still running in PiggerCode.' }],
    ['an offline machine', { ok: false, errorCode: 'machine_offline', error: 'Machine is offline' }],
    ['a rejected request', { ok: false, errorCode: 'invalid_request', error: 'bad source' }],
  ])('refuses to trash without the machine when it answers %s', async (_label, answer) => {
    mockMachineRpc.mockResolvedValue(answer);

    expect(await sessionTrashWithServerScope('sid-direct', { serverId: 'server-a' })).toEqual({ success: false, message: answer.error });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses to restore when the machine cannot be reached', async () => {
    mockMachineRpc.mockRejectedValue(new Error('RPC timed out'));

    expect(await sessionRestoreFromTrashWithServerScope('sid-direct', { serverId: 'server-a', metadata: linkedMetadata }))
      .toEqual({ success: false, message: 'RPC timed out' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('trashes on the server alone only when the provider keeps no copy it could move', async () => {
    mockMachineRpc.mockResolvedValue({ ok: false, errorCode: 'provider_unavailable', error: 'no trash', unsupported: true });
    respondWith(makeResponse({ ok: true }));

    expect(await sessionTrashWithServerScope('sid-direct', { serverId: 'server-a' })).toEqual({ success: true });
    expect(mockRequest).toHaveBeenCalledWith('/v2/sessions/sid-direct/trash', expect.objectContaining({ method: 'POST' }), expect.any(Function));
  });
});
