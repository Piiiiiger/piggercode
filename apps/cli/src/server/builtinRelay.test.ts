import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBuiltinRelay(url: string) {
  vi.stubEnv('PIGGERCODE_BUILTIN_RELAY_URL', url);
  vi.resetModules();
  return (await import('./builtinRelay')).BUILTIN_RELAY;
}

describe('BUILTIN_RELAY', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the relay the machine names', async () => {
    const relay = await loadBuiltinRelay('https://relay.example.test/');

    expect(relay).toMatchObject({ serverUrl: 'https://relay.example.test', webappUrl: 'https://relay.example.test', configured: true });
  });

  it('points at a reserved address when no relay is named or the address is not http(s)', async () => {
    for (const url of ['', 'not a url', 'ftp://relay.example.test']) {
      const relay = await loadBuiltinRelay(url);

      expect(relay).toMatchObject({ serverUrl: 'https://relay.invalid', configured: false });
    }
  });
});
