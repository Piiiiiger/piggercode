import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDirSync } from '@/testkit/fs/tempDir';
import { captureConsoleText } from '@/testkit/logger/captureOutput';

describe('resolveDaemonServiceCliRuntimeFromEnv entrypoint resolution', () => {
  const envKeys = [
    'PIGGERCODE_HOME_DIR',
    'PIGGERCODE_DAEMON_SERVICE_NODE_PATH',
    'PIGGERCODE_DAEMON_SERVICE_ENTRY_PATH',
    'PIGGERCODE_PUBLIC_RELEASE_CHANNEL',
    'PIGGERCODE_RELEASE_RING',
    'PIGGERCODE_RELEASE_CHANNEL',
    'PIGGERCODE_DAEMON_SERVICE_CHANNEL',
  ] as const;
  let envScope = createEnvKeyScope(envKeys);

  afterEach(() => {
    envScope.restore();
    envScope = createEnvKeyScope(envKeys);
    vi.resetModules();
  });

  it('derives the bundled entrypoint for an explicit managed js runtime wrapper path', async () => {
    withTempDirSync('happier-cli-daemon-service-entry-', (homeDir) => {
      envScope.patch({
        PIGGERCODE_HOME_DIR: homeDir,
        PIGGERCODE_DAEMON_SERVICE_NODE_PATH: '/Users/test/.piggercode/tools/js-runtime/current/bin/happier-js-runtime',
      });

      const output = captureConsoleText();
      return import('./cli.js')
        .then(({ resolveDaemonServiceCliRuntimeFromEnv }) => {
          const runtime = resolveDaemonServiceCliRuntimeFromEnv();
          expect(runtime.nodePath).toBe('/Users/test/.piggercode/tools/js-runtime/current/bin/happier-js-runtime');
          expect(runtime.entryPath).toContain('/apps/cli/package-dist/index.mjs');
        })
        .finally(() => {
          output.restore();
        });
    });
  });

  it('infers the preview release channel from a managed preview entry path when re-execed through node', async () => {
    withTempDirSync('happier-cli-daemon-service-preview-ring-', (homeDir) => {
      envScope.patch({
        PIGGERCODE_HOME_DIR: homeDir,
        PIGGERCODE_PUBLIC_RELEASE_CHANNEL: '',
        PIGGERCODE_RELEASE_RING: '',
        PIGGERCODE_RELEASE_CHANNEL: '',
        PIGGERCODE_DAEMON_SERVICE_CHANNEL: '',
      });

      const originalArgv = [...process.argv];
      process.argv = [
        '/Users/test/.piggercode/tools/js-runtime/current/runtime/bin/node',
        '/Users/test/.piggercode/cli-preview/versions/0.2.3/package-dist/index.mjs',
        'service',
        'install',
      ];

      const output = captureConsoleText();
      return import('./cli.js')
        .then(({ resolveDaemonServiceCliRuntimeFromEnv }) => {
          const runtime = resolveDaemonServiceCliRuntimeFromEnv();
          expect(runtime.channel).toBe('preview');
        })
        .finally(() => {
          process.argv = originalArgv;
          output.restore();
        });
    });
  });

  it('infers the public dev release channel from an explicit managed dev entry path when argv no longer carries the lane', async () => {
    withTempDirSync('happier-cli-daemon-service-dev-ring-', (homeDir) => {
      envScope.patch({
        PIGGERCODE_HOME_DIR: homeDir,
        PIGGERCODE_DAEMON_SERVICE_NODE_PATH: '/Users/test/.piggercode/tools/js-runtime/current/bin/happier-js-runtime',
        PIGGERCODE_DAEMON_SERVICE_ENTRY_PATH: '/Users/test/.piggercode/cli-dev/versions/0.2.3/package-dist/index.mjs',
        PIGGERCODE_PUBLIC_RELEASE_CHANNEL: '',
        PIGGERCODE_RELEASE_RING: '',
        PIGGERCODE_RELEASE_CHANNEL: '',
        PIGGERCODE_DAEMON_SERVICE_CHANNEL: '',
      });

      const originalArgv = [...process.argv];
      process.argv = [
        '/Users/test/.piggercode/tools/js-runtime/current/bin/happier-js-runtime',
        'service',
        'install',
      ];

      const output = captureConsoleText();
      return import('./cli.js')
        .then(({ resolveDaemonServiceCliRuntimeFromEnv }) => {
          const runtime = resolveDaemonServiceCliRuntimeFromEnv();
          expect(runtime.channel).toBe('publicdev');
        })
        .finally(() => {
          process.argv = originalArgv;
          output.restore();
        });
    });
  });
});
