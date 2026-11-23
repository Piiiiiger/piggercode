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
