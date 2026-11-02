import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnvKeyScope } from '@/testkit/env/envScope';

const envScope = createEnvKeyScope([
  'PIGGERCODE_SERVER_URL',
  'PIGGERCODE_LOCAL_SERVER_URL',
  'PIGGERCODE_PUBLIC_SERVER_URL',
  'PIGGERCODE_WEBAPP_URL',
  'PIGGERCODE_HOME_DIR',
]);

describe('configuration apiServerUrl', () => {
  afterEach(() => {
    envScope.restore();
    vi.resetModules();
  });

  it('treats PIGGERCODE_PUBLIC_SERVER_URL as canonical serverUrl and uses PIGGERCODE_SERVER_URL for apiServerUrl when they differ', async () => {
    process.env.PIGGERCODE_SERVER_URL = 'http://127.0.0.1:3005';
    process.env.PIGGERCODE_PUBLIC_SERVER_URL = 'https://my-stack.example.test';
    process.env.PIGGERCODE_WEBAPP_URL = 'https://app.happier.dev';

    vi.resetModules();
    const { configuration } = await import('./configuration');
    expect(configuration.serverUrl).toBe('https://my-stack.example.test');
    expect((configuration as any).apiServerUrl).toBe('http://127.0.0.1:3005');
    expect(configuration.webappUrl).toBe('https://app.happier.dev');
  });

  it('ignores a stale PIGGERCODE_LOCAL_SERVER_URL when PIGGERCODE_SERVER_URL already points at a local stack', async () => {
    process.env.PIGGERCODE_SERVER_URL = 'http://127.0.0.1:41845';
    process.env.PIGGERCODE_LOCAL_SERVER_URL = 'http://127.0.0.1:49597';
    delete process.env.PIGGERCODE_PUBLIC_SERVER_URL;
    process.env.PIGGERCODE_WEBAPP_URL = 'http://127.0.0.1:41845';

    vi.resetModules();
    const { configuration } = await import('./configuration');
    expect(configuration.serverUrl).toBe('http://127.0.0.1:41845');
    expect(configuration.apiServerUrl).toBe('http://127.0.0.1:41845');
    expect(configuration.webappUrl).toBe('http://127.0.0.1:41845');
  });
});
