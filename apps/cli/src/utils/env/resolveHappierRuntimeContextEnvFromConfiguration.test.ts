import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

const ENV_KEYS = [
  'PIGGERCODE_HOME_DIR',
  'PIGGERCODE_ACTIVE_SERVER_ID',
  'PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID',
  'PIGGERCODE_SERVER_URL',
  'PIGGERCODE_LOCAL_SERVER_URL',
  'PIGGERCODE_PUBLIC_SERVER_URL',
  'PIGGERCODE_WEBAPP_URL',
  'PIGGERCODE_ACCESS_TOKEN',
] as const;

let envScope = createEnvKeyScope(ENV_KEYS);
const tempDirs = new Set<string>();

afterEach(() => {
  envScope.restore();
  envScope = createEnvKeyScope(ENV_KEYS);
  for (const dir of tempDirs) removeTempDirSync(dir);
  tempDirs.clear();
  vi.resetModules();
});

describe('resolveHappierRuntimeContextEnvFromConfiguration', () => {
  it('forwards the resolved configuration home/server context as authoritative, non-secret env', async () => {
    const home = createTempDirSync('happier-runtime-ctx-home-');
    tempDirs.add(home);
    envScope.patch({
      PIGGERCODE_HOME_DIR: home,
      PIGGERCODE_ACTIVE_SERVER_ID: 'preview',
      PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID: 'stack_repo-remote-dev-d72117acdb__id_default',
      // public != server -> split local/public stack
      PIGGERCODE_PUBLIC_SERVER_URL: 'https://public.happier.example',
      PIGGERCODE_SERVER_URL: 'http://127.0.0.1:48999',
      PIGGERCODE_WEBAPP_URL: 'https://app.happier.example',
      PIGGERCODE_ACCESS_TOKEN: 'secret-token-that-must-not-leak',
    });
    vi.resetModules();

    const { resolveHappierRuntimeContextEnvFromConfiguration } = await import(
      './resolveHappierRuntimeContextEnvFromConfiguration'
    );
    const { PIGGERCODE_RUNTIME_CONTEXT_ENV_KEYS } = await import('./resolveHappierRuntimeContextEnv');

    const env = resolveHappierRuntimeContextEnvFromConfiguration();

    // Home dir flows through from configuration (the credential anchor).
    expect(env.PIGGERCODE_HOME_DIR).toBe(home);
    // A resolved server URL is always present.
    expect(env.PIGGERCODE_SERVER_URL).toBeTruthy();
    expect(env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID).toBe(
      'stack_repo-remote-dev-d72117acdb__id_default',
    );

    // Only allowed, non-secret context keys are emitted.
    for (const key of Object.keys(env)) {
      expect(PIGGERCODE_RUNTIME_CONTEXT_ENV_KEYS).toContain(key);
    }
    expect(env).not.toHaveProperty('PIGGERCODE_ACCESS_TOKEN');
    expect(JSON.stringify(env)).not.toContain('secret-token-that-must-not-leak');
  });
});
