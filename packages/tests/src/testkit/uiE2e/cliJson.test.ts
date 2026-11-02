import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

// The child process is the boundary; keep launch resolution and environment composition real.
vi.mock('../process/spawnProcess', () => ({
  runLoggedCommand: async (params: { env: NodeJS.ProcessEnv; stdoutPath: string }) => {
    await writeFile(params.stdoutPath, JSON.stringify({
      ok: true,
      kind: 'environment_probe',
      data: {
        activeServerId: params.env.PIGGERCODE_ACTIVE_SERVER_ID ?? null,
        daemonInstanceId: params.env.PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID ?? null,
        daemonServerUrl: params.env.PIGGERCODE_DAEMON_SERVICE_SERVER_URL ?? null,
        serverUrl: params.env.PIGGERCODE_SERVER_URL,
        homeDir: params.env.PIGGERCODE_HOME_DIR,
        probe: params.env.PIGGERCODE_TEST_ENV_PROBE,
      },
    }));
  },
}));

import { runCliJson } from './cliJson';

it('uses the fixture credential namespace instead of ambient stack server selection', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'happier-cli-json-env-'));
  const cliHomeDir = join(testDir, 'cli-home');
  const serverUrl = 'http://127.0.0.1:4011';
  try {
    const result = await runCliJson({
      testDir,
      cliHomeDir,
      serverUrl,
      webappUrl: 'http://127.0.0.1:4012',
      label: 'environment',
      args: ['auth', 'status', '--json'],
      env: {
        ...process.env,
        PIGGERCODE_ACTIVE_SERVER_ID: 'ambient-stack',
        PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID: 'ambient-daemon',
        PIGGERCODE_DAEMON_SERVICE_SERVER_URL: 'https://ambient.invalid',
        PIGGERCODE_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
        PIGGERCODE_E2E_PROVIDER_SKIP_CLI_SHARED_DEPS_BUILD: '1',
        PIGGERCODE_TEST_ENV_PROBE: 'preserved',
      },
    });
    expect(result).toEqual({
      ok: true,
      kind: 'environment_probe',
      data: {
        activeServerId: null,
        daemonInstanceId: null,
        daemonServerUrl: null,
        serverUrl,
        homeDir: cliHomeDir,
        probe: 'preserved',
      },
    });
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});
