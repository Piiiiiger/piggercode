import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_ENV_KEYS = [
  'PIGGERCODE_ACTIVE_SERVER_ID',
  'PIGGERCODE_SERVER_URL',
  'PIGGERCODE_LOCAL_SERVER_URL',
  'PIGGERCODE_PUBLIC_SERVER_URL',
  'PIGGERCODE_WEBAPP_URL',
] as const;

function stubServerEnv(values: Partial<Record<typeof SERVER_ENV_KEYS[number], string>>): void {
  for (const key of SERVER_ENV_KEYS) {
    vi.stubEnv(key, values[key] ?? '');
  }
}

describe('resolveServerHttpBaseUrl', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('changes endpoints only after the canonical configuration selection is reloaded', async () => {
    vi.resetModules();
    stubServerEnv({
      PIGGERCODE_ACTIVE_SERVER_ID: 'stale-stack',
      PIGGERCODE_SERVER_URL: 'http://127.0.0.1:41001',
    });

    const configurationModule = await import('@/configuration');
    const { resolveServerHttpBaseUrl } = await import('./serverHttpBaseUrl');

    stubServerEnv({
      PIGGERCODE_ACTIVE_SERVER_ID: 'live-stack',
      PIGGERCODE_SERVER_URL: 'http://127.0.0.1:52002',
    });

    expect(resolveServerHttpBaseUrl()).toBe('http://127.0.0.1:41001');

    configurationModule.reloadConfiguration();
    expect(resolveServerHttpBaseUrl()).toBe('http://127.0.0.1:52002');
  });

  it('keeps HTTP and socket traffic on the persisted active profile when inherited URLs contradict it', async () => {
    const homeDir = join(tmpdir(), `happier-server-http-selection-${process.pid}-${Date.now()}`);
    tempDirs.push(homeDir);
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({
      schemaVersion: 6,
      activeServerId: 'selected-profile',
      servers: {
        'selected-profile': {
          id: 'selected-profile',
          serverUrl: 'http://127.0.0.1:52755',
          localServerUrl: 'http://127.0.0.1:52755',
          webappUrl: 'http://localhost:18829',
        },
        'other-profile': {
          id: 'other-profile',
          serverUrl: 'http://127.0.0.1:52753',
          localServerUrl: 'http://127.0.0.1:52753',
          webappUrl: 'http://localhost:18829',
        },
      },
    }));
    vi.stubEnv('PIGGERCODE_HOME_DIR', homeDir);
    stubServerEnv({
      PIGGERCODE_ACTIVE_SERVER_ID: 'selected-profile',
      PIGGERCODE_SERVER_URL: 'http://127.0.0.1:52753',
      PIGGERCODE_WEBAPP_URL: 'http://localhost:18829',
    });

    const { configuration } = await import('@/configuration');
    const { resolveServerHttpBaseUrl } = await import('./serverHttpBaseUrl');

    expect(configuration.activeServerId).toBe('selected-profile');
    expect(configuration.apiServerUrl).toBe('http://127.0.0.1:52755');
    expect(resolveServerHttpBaseUrl()).toBe('http://127.0.0.1:52755');
  });
});
