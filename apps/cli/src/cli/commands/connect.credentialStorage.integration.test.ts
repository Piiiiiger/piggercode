import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { installAxiosFastifyAdapter } from '@/testkit/http/axiosAdapter';

const promptInputMock = vi.fn(async (_prompt: string) => 'sk-ant-test');

vi.mock('@/terminal/prompts/promptInput', () => ({
  promptInput: (prompt: string) => promptInputMock(prompt),
}));

// Opening a browser is an OS boundary; native import must never enter it.
vi.mock('@/ui/openBrowser', () => ({ openBrowser: async () => { throw new Error('Unexpected interactive authentication during native import'); } }));

describe('connect credential storage', () => {
  const envKeys = [
    'PIGGERCODE_HOME_DIR',
    'PIGGERCODE_SERVER_URL',
    'PIGGERCODE_LOCAL_SERVER_URL',
    'PIGGERCODE_VARIANT',
    'CODEX_HOME',
  ] as const;
  let envScope = createEnvKeyScope(envKeys);
  let homeDir = '';

  beforeEach(async () => {
    envScope = createEnvKeyScope(envKeys);
    homeDir = await createTempDir('happier-cli-connect-');
    promptInputMock.mockReset();
    promptInputMock.mockResolvedValue('sk-ant-test');
  });

  afterEach(async () => {
    envScope.restore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    await removeTempDir(homeDir);
  });

  it('imports native Codex credentials into a named profile without interactive authentication', async () => {
    const writes: unknown[] = [];
    const app = fastify({ logger: false });
    app.get('/v1/account/encryption', async () => ({ mode: 'plain', updatedAt: 1 }));
    app.get('/v3/connect/openai-codex/profiles/personal/credential', async (_request, reply) => reply.code(404).send({ error: 'not_found' }));
    app.post('/v3/connect/openai-codex/profiles/personal/credential', async (request) => { writes.push(request.body); return { success: true, credentialRevision: 'csr_abcdefghijklmnopqrstuv' }; });
    await app.ready();
    const restoreAxios = installAxiosFastifyAdapter({ app, origin: 'http://happier-connect.test' });
    const claims = { exp: Math.floor(Date.now() / 1000) + 3600, email: 'synthetic@example.test' };
    const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
    await writeFile(join(homeDir, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: jwt, access_token: jwt, refresh_token: 'synthetic-refresh', account_id: 'synthetic-account' } }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code): never => { throw new Error(`process.exit:${String(code ?? '')}`); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      if (String(input) === 'http://happier-connect.test/v1/features') return Response.json({ features: {}, capabilities: { connectedServices: { credentialWrite: { revisionGuard: true } } } });
      throw new Error('Native valid Codex import must not begin OAuth or refresh.');
    }));
    try {
      envScope.patch({ CODEX_HOME: homeDir, PIGGERCODE_HOME_DIR: homeDir, PIGGERCODE_SERVER_URL: 'http://happier-connect.test', PIGGERCODE_LOCAL_SERVER_URL: 'http://happier-connect.test', PIGGERCODE_VARIANT: 'stable' });
      vi.resetModules();
      const { writeCredentialsLegacy } = await import('@/persistence');
      await writeCredentialsLegacy({ secret: new Uint8Array(32).fill(7), token: 'happy-token' });
      const { handleConnectCommand } = await import('./connect');
      await expect(handleConnectCommand(['codex', '--import', '--source', 'native', '--profile', 'personal'])).rejects.toThrow('process.exit:0');
      expect(promptInputMock).not.toHaveBeenCalled();
      expect(writes).toEqual([expect.objectContaining({ expectedCredentialRevision: null, content: { t: 'plain', v: expect.objectContaining({ serviceId: 'openai-codex', profileId: 'personal', oauth: expect.objectContaining({ providerAccountId: 'synthetic-account', refreshToken: 'synthetic-refresh' }) }) } })]);
    } finally { exitSpy.mockRestore(); restoreAxios(); await app.close(); }
  });

  it('pre-reads a plain account credential and creates it with an expect-absent guard', async () => {
    const writes: unknown[] = [];
    const app = fastify({ logger: false });
    app.get('/v1/account/encryption', async () => ({ mode: 'plain', updatedAt: 1 }));
    app.get('/v3/connect/anthropic/profiles/default/credential', async (_request, reply) => {
      return reply.code(404).send({ error: 'not_found' });
    });
    app.post('/v3/connect/anthropic/profiles/default/credential', async (request) => {
      writes.push(request.body);
      return {
        success: true,
        credentialRevision: 'csr_abcdefghijklmnopqrstuv',
      };
    });
    await app.ready();
    const restoreAxios = installAxiosFastifyAdapter({ app, origin: 'http://happier-connect.test' });
    const fetchBoundary = vi.fn<typeof fetch>(async () => { throw new Error('Released-service authoring must not probe server capabilities'); });
    vi.stubGlobal('fetch', fetchBoundary);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code): never => {
      throw new Error(`process.exit:${String(code ?? '')}`);
    });

    try {
      envScope.patch({
        PIGGERCODE_HOME_DIR: homeDir,
        PIGGERCODE_SERVER_URL: 'http://happier-connect.test',
        PIGGERCODE_LOCAL_SERVER_URL: 'http://happier-connect.test',
        PIGGERCODE_VARIANT: 'stable',
      });
      vi.resetModules();
      const { writeCredentialsLegacy } = await import('@/persistence');
      await writeCredentialsLegacy({ secret: new Uint8Array(32).fill(7), token: 'happy-token' });

      const { handleConnectCommand } = await import('./connect');
      await expect(handleConnectCommand(['claude', '--api-key'])).rejects.toThrow('process.exit:0');
      expect(fetchBoundary).not.toHaveBeenCalled();

      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        content: {
          t: 'plain',
          v: {
            serviceId: 'anthropic',
            profileId: 'default',
            kind: 'token',
            token: { token: 'sk-ant-test' },
          },
        },
        expectedCredentialRevision: null,
      });
    } finally {
      exitSpy.mockRestore();
      restoreAxios();
      await app.close();
    }
  });
});
