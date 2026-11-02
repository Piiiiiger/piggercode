import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';

const envScope = createEnvKeyScope([
  'PIGGERCODE_VARIANT',
  'PIGGERCODE_PUBLIC_RELEASE_CHANNEL',
  'PIGGERCODE_RELEASE_RING',
  'PIGGERCODE_RELEASE_CHANNEL',
  'PIGGERCODE_HOME_DIR',
  'PIGGERCODE_CLI_SUBPROCESS_DIST_ENTRYPOINT',
  'PIGGERCODE_CLI_SUBPROCESS_DAEMON_DIST_CLOSURE_FINGERPRINT',
]);

describe('spawnDetachedDaemonStartSync', () => {
  afterEach(() => {
    envScope.restore();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('forwards PIGGERCODE_PUBLIC_RELEASE_CHANNEL to the detached daemon so it does not fall back to stable', async () => {
    envScope.patch({
      PIGGERCODE_VARIANT: 'dev',
      PIGGERCODE_PUBLIC_RELEASE_CHANNEL: undefined,
      PIGGERCODE_RELEASE_RING: undefined,
      PIGGERCODE_RELEASE_CHANNEL: undefined,
      PIGGERCODE_HOME_DIR: '/tmp/happier-spawn-detached-test',
      PIGGERCODE_CLI_SUBPROCESS_DIST_ENTRYPOINT: undefined,
      PIGGERCODE_CLI_SUBPROCESS_DAEMON_DIST_CLOSURE_FINGERPRINT: undefined,
    });
    // Simulate invoking the CLI via the dev shim name.
    process.argv = ['node', '/Users/alice/.happier/bin/hdev', 'daemon', 'start'];

    const spawnMock: Mock<(typeof import('child_process'))['spawn']> = vi.fn(() => ({ unref() {} }) as any);
    vi.doMock('child_process', () => ({
      spawn: spawnMock,
    }));

    vi.resetModules();
    const { spawnDetachedDaemonStartSync } = await import('./spawnDetachedDaemonStartSync');
    await spawnDetachedDaemonStartSync();

    expect(spawnMock).toHaveBeenCalled();
    const opts = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(opts?.env?.PIGGERCODE_PUBLIC_RELEASE_CHANNEL).toBe('dev');
  });
});
