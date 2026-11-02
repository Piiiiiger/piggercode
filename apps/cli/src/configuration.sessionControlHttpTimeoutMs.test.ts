import { afterEach, describe, expect, it, vi } from 'vitest';

describe('configuration sessionControlHttpTimeoutMs', () => {
  const prev = process.env.PIGGERCODE_SESSION_CONTROL_HTTP_TIMEOUT_MS;

  afterEach(() => {
    if (prev === undefined) delete process.env.PIGGERCODE_SESSION_CONTROL_HTTP_TIMEOUT_MS;
    else process.env.PIGGERCODE_SESSION_CONTROL_HTTP_TIMEOUT_MS = prev;
    vi.resetModules();
  });

  it('defaults to 60s when unset', async () => {
    delete process.env.PIGGERCODE_SESSION_CONTROL_HTTP_TIMEOUT_MS;
    vi.resetModules();
    const { configuration } = await import('./configuration');
    expect(configuration.sessionControlHttpTimeoutMs).toBe(60_000);
  });

  it('uses PIGGERCODE_SESSION_CONTROL_HTTP_TIMEOUT_MS when set', async () => {
    process.env.PIGGERCODE_SESSION_CONTROL_HTTP_TIMEOUT_MS = '54321';
    vi.resetModules();
    const { configuration } = await import('./configuration');
    expect(configuration.sessionControlHttpTimeoutMs).toBe(54_321);
  });
});

