import { describe, expect, it } from 'vitest';

import {
  PIGGERCODE_RUNTIME_CONTEXT_ENV_KEYS,
  resolveHappierRuntimeContextEnv,
} from './resolveHappierRuntimeContextEnv';

describe('resolveHappierRuntimeContextEnv', () => {
  it('returns only PIGGERCODE_HOME_DIR when given just a home dir', () => {
    expect(resolveHappierRuntimeContextEnv({ homeDir: '/home/.happier' })).toEqual({
      PIGGERCODE_HOME_DIR: '/home/.happier',
    });
  });

  it('sets a single PIGGERCODE_SERVER_URL for a non-split stack (api === canonical) and omits local/public', () => {
    const env = resolveHappierRuntimeContextEnv({
      homeDir: '/home/.happier',
      server: {
        activeServerId: 'cloud',
        canonicalServerUrl: 'https://api.happier.dev',
        apiServerUrl: 'https://api.happier.dev',
        webappUrl: 'https://app.happier.dev',
      },
    });

    expect(env).toEqual({
      PIGGERCODE_HOME_DIR: '/home/.happier',
      PIGGERCODE_ACTIVE_SERVER_ID: 'cloud',
      PIGGERCODE_SERVER_URL: 'https://api.happier.dev',
      PIGGERCODE_WEBAPP_URL: 'https://app.happier.dev',
    });
    expect(env).not.toHaveProperty('PIGGERCODE_LOCAL_SERVER_URL');
    expect(env).not.toHaveProperty('PIGGERCODE_PUBLIC_SERVER_URL');
  });

  it('expresses a split local/public stack: SERVER=local, LOCAL=local, PUBLIC=canonical', () => {
    const env = resolveHappierRuntimeContextEnv({
      homeDir: '/home/.happier',
      daemonLifecycleScopeId: 'stack_repo-remote-dev-d72117acdb__id_default',
      server: {
        activeServerId: 'android-keyboard-qa',
        canonicalServerUrl: 'http://127.0.0.1:13155',
        apiServerUrl: 'http://127.0.0.1:3005',
        webappUrl: 'http://127.0.0.1:13155',
      },
    });

    expect(env).toEqual({
      PIGGERCODE_HOME_DIR: '/home/.happier',
      PIGGERCODE_ACTIVE_SERVER_ID: 'android-keyboard-qa',
      PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID: 'stack_repo-remote-dev-d72117acdb__id_default',
      PIGGERCODE_SERVER_URL: 'http://127.0.0.1:3005',
      PIGGERCODE_LOCAL_SERVER_URL: 'http://127.0.0.1:3005',
      PIGGERCODE_PUBLIC_SERVER_URL: 'http://127.0.0.1:13155',
      PIGGERCODE_WEBAPP_URL: 'http://127.0.0.1:13155',
    });
  });

  it('matches the daemon buildSpawnChildProcessEnv server-selection block (server only, no home dir)', () => {
    // Same inputs as buildSpawnChildProcessEnv.test.ts split case, proving the
    // shared helper is behavior-preserving for the daemon path.
    expect(
      resolveHappierRuntimeContextEnv({
        server: {
          activeServerId: 'stack-a',
          canonicalServerUrl: 'http://127.0.0.1:13155',
          apiServerUrl: 'http://127.0.0.1:3005',
          webappUrl: 'http://127.0.0.1:13155',
        },
      }),
    ).toEqual({
      PIGGERCODE_ACTIVE_SERVER_ID: 'stack-a',
      PIGGERCODE_SERVER_URL: 'http://127.0.0.1:3005',
      PIGGERCODE_LOCAL_SERVER_URL: 'http://127.0.0.1:3005',
      PIGGERCODE_PUBLIC_SERVER_URL: 'http://127.0.0.1:13155',
      PIGGERCODE_WEBAPP_URL: 'http://127.0.0.1:13155',
    });
  });

  it('ignores empty/whitespace values and returns an empty map for empty input', () => {
    expect(resolveHappierRuntimeContextEnv({ homeDir: '   ' })).toEqual({});
    expect(resolveHappierRuntimeContextEnv({})).toEqual({});
    expect(
      resolveHappierRuntimeContextEnv({
        homeDir: '/home/.happier',
        server: {
          activeServerId: '',
          canonicalServerUrl: '',
          apiServerUrl: '',
          webappUrl: '',
        },
      }),
    ).toEqual({ PIGGERCODE_HOME_DIR: '/home/.happier' });
  });

  it('falls back to the api URL for PIGGERCODE_SERVER_URL when only the api URL is known', () => {
    const env = resolveHappierRuntimeContextEnv({
      server: {
        activeServerId: 'cloud',
        canonicalServerUrl: '',
        apiServerUrl: 'https://api.happier.dev',
        webappUrl: '',
      },
    });
    expect(env).toEqual({
      PIGGERCODE_ACTIVE_SERVER_ID: 'cloud',
      PIGGERCODE_SERVER_URL: 'https://api.happier.dev',
    });
  });

  it('never emits secret-bearing keys', () => {
    const env = resolveHappierRuntimeContextEnv({
      homeDir: '/home/.happier',
      server: {
        activeServerId: 'cloud',
        canonicalServerUrl: 'https://api.happier.dev',
        apiServerUrl: 'https://api.happier.dev',
        webappUrl: 'https://app.happier.dev',
      },
    });
    for (const key of Object.keys(env)) {
      expect(PIGGERCODE_RUNTIME_CONTEXT_ENV_KEYS).toContain(key);
    }
    expect(env).not.toHaveProperty('PIGGERCODE_ACCESS_TOKEN');
  });
});
