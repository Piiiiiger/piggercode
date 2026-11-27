import type { AgyAccountUsageReportV1 } from '@piggercode/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SPAWN_SESSION_ERROR_CODES } from '@/rpc/handlers/registerSessionHandlers';

import { createDaemonControlApp } from './controlServer';

const REPORT: AgyAccountUsageReportV1 = {
  email: 'someone@example.com',
  planTier: 'pro',
  observedAtMs: 1_000,
  meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: 2_000 }],
};

describe('createDaemonControlApp /agy-account-usage', () => {
  const apps: Array<ReturnType<typeof createDaemonControlApp>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start(record: (report: AgyAccountUsageReportV1) => Promise<void>) {
    const app = createDaemonControlApp({
      getChildren: () => [],
      machineId: 'machine-1',
      stopSession: vi.fn(async () => ({ status: 'stopped' as const })),
      spawnSession: vi.fn(async () => ({
        type: 'error' as const,
        errorCode: SPAWN_SESSION_ERROR_CODES.UNEXPECTED,
        errorMessage: 'unused',
      })),
      requestShutdown: vi.fn(),
      onHappySessionWebhook: vi.fn(),
      controlToken: 'control-token',
      handleAgyAccountUsageReport: record,
    });
    apps.push(app);
    await app.ready();
    return app;
  }

  it('takes a session\'s reading, without any field it does not know', async () => {
    const record = vi.fn(async (_report: AgyAccountUsageReportV1) => {});
    const app = await start(record);
    const response = await app.inject({
      method: 'POST',
      url: '/agy-account-usage',
      headers: { 'x-happier-daemon-token': 'control-token' },
      payload: { ...REPORT, token: 'must-not-be-kept' },
    });
    expect(response.statusCode).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toEqual(REPORT);
  });

  it('refuses a caller without the control token, and a malformed reading', async () => {
    const record = vi.fn(async (_report: AgyAccountUsageReportV1) => {});
    const app = await start(record);
    const unauthorized = await app.inject({ method: 'POST', url: '/agy-account-usage', payload: REPORT });
    expect(unauthorized.statusCode).toBe(401);
    const malformed = await app.inject({
      method: 'POST',
      url: '/agy-account-usage',
      headers: { 'x-happier-daemon-token': 'control-token' },
      payload: { ...REPORT, meters: [] },
    });
    expect(malformed.statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('createDaemonControlApp /agy-account routes', () => {
  const apps: Array<ReturnType<typeof createDaemonControlApp>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  type Options = Parameters<typeof createDaemonControlApp>[0];
  async function start(handlers: Readonly<{ launch?: Options['handleAgyLaunchAccount']; session?: Options['handleAgyAccountSession'] }>) {
    const app = createDaemonControlApp({
      getChildren: () => [],
      machineId: 'machine-1',
      stopSession: vi.fn(async () => ({ status: 'stopped' as const })),
      spawnSession: vi.fn(async () => ({
        type: 'error' as const,
        errorCode: SPAWN_SESSION_ERROR_CODES.UNEXPECTED,
        errorMessage: 'unused',
      })),
      requestShutdown: vi.fn(),
      onHappySessionWebhook: vi.fn(),
      controlToken: 'control-token',
      ...(handlers.launch ? { handleAgyLaunchAccount: handlers.launch } : {}),
      ...(handlers.session ? { handleAgyAccountSession: handlers.session } : {}),
    });
    apps.push(app);
    await app.ready();
    return app;
  }
  const headers = { 'x-happier-daemon-token': 'control-token' };

  it('answers a launch request with the daemon\'s choice', async () => {
    const launch = vi.fn(async () => ({ ok: true as const, accountId: 'b', accountHomeDir: '/logins/b', unavailable: [] }));
    const app = await start({ launch });
    const response = await app.inject({ method: 'POST', url: '/agy-account/launch', headers, payload: { runnerKey: 'k', modelId: null } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, accountId: 'b', accountHomeDir: '/logins/b', unavailable: [] });
    expect(launch).toHaveBeenCalledWith({ runnerKey: 'k', modelId: null });
  });

  it('passes a session request to the daemon\'s decider and refuses an unknown kind or a caller without the token', async () => {
    const session = vi.fn(async () => ({ ok: true as const, decision: { action: 'none' as const } }));
    const app = await start({ session });
    const ok = await app.inject({
      method: 'POST',
      url: '/agy-account/session',
      headers,
      payload: { kind: 'signals', runnerKey: 'k', accountId: 'default', childEpoch: 1, modelId: null, conversationId: null, limitHit: false },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, decision: { action: 'none' } });
    expect((await app.inject({ method: 'POST', url: '/agy-account/session', headers, payload: { kind: 'other' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/agy-account/session', payload: { kind: 'ended', runnerKey: 'k' } })).statusCode).toBe(401);
    expect(session).toHaveBeenCalledTimes(1);
  });

  it('says it is not available when the daemon has no handler', async () => {
    const app = await start({});
    const response = await app.inject({ method: 'POST', url: '/agy-account/launch', headers, payload: { runnerKey: 'k', modelId: null } });
    expect(response.statusCode).toBe(501);
  });
});
