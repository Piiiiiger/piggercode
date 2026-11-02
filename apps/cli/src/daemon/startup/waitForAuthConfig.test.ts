import { describe, expect, it } from 'vitest';

import { resolveWaitForAuthConfig } from './waitForAuthConfig';

describe('resolveWaitForAuthConfig', () => {
  it('uses defaults when env vars are absent', () => {
    const config = resolveWaitForAuthConfig({});

    expect(config.waitForAuthEnabled).toBe(false);
    // Mirrors existing daemon behavior: absent timeout env parses as Number('') => 0.
    expect(config.waitForAuthTimeoutMs).toBe(0);
  });

  it('parses enabled flags and non-negative timeout', () => {
    const config = resolveWaitForAuthConfig({
      PIGGERCODE_DAEMON_WAIT_FOR_AUTH: 'yes',
      PIGGERCODE_DAEMON_WAIT_FOR_AUTH_TIMEOUT_MS: '1234',
    });

    expect(config.waitForAuthEnabled).toBe(true);
    expect(config.waitForAuthTimeoutMs).toBe(1234);
  });

  it('falls back to default timeout for invalid values', () => {
    const negative = resolveWaitForAuthConfig({ PIGGERCODE_DAEMON_WAIT_FOR_AUTH_TIMEOUT_MS: '-1' });
    const invalid = resolveWaitForAuthConfig({ PIGGERCODE_DAEMON_WAIT_FOR_AUTH_TIMEOUT_MS: 'abc' });

    expect(negative.waitForAuthTimeoutMs).toBe(600_000);
    expect(invalid.waitForAuthTimeoutMs).toBe(600_000);
  });
});
