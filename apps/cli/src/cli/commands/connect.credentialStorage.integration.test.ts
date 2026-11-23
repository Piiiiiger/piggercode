import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import {
  OPENAI_CODEX_DEVICE_TOKEN_URL,
  OPENAI_CODEX_DEVICE_USER_CODE_URL,
  OPENAI_CODEX_OAUTH_TOKEN_URL,
} from '@piggercode/agents';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { installAxiosFastifyAdapter } from '@/testkit/http/axiosAdapter';

const promptInputMock = vi.fn(async (_prompt: string) => 'sk-ant-test');

vi.mock('@/terminal/prompts/promptInput', () => ({
  promptInput: (prompt: string) => promptInputMock(prompt),
}));

describe('connect credential storage', () => {
  const envKeys = [
    'PIGGERCODE_HOME_DIR',
    'PIGGERCODE_SERVER_URL',
    'PIGGERCODE_LOCAL_SERVER_URL',
    'PIGGERCODE_VARIANT',
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

  it.each(['--device', '--paste'])('records a Codex login completed with %s as a fresh authorization', async (flag) => {
    const writes: unknown[] = [];
    const app = fastify({ logger: false });
    app.get('/v1/account/encryption', async () => ({ mode: 'plain', updatedAt: 1 }));
    app.get('/v2/connect/openai-codex/profiles', async () => ({ serviceId: 'openai-codex', profiles: [] }));
    app.get('/v3/connect/openai-codex/profiles/default/credential', async (_request, reply) => {
      return reply.code(404).send({ error: 'not_found' });
    });
    app.post('/v3/connect/openai-codex/profiles/default/credential', async (request) => {
      writes.push(request.body);
      return { success: true, credentialRevision: 'csr_abcdefghijklmnopqrstuv' };
    });
    await app.ready();
    const restoreAxios = installAxiosFastifyAdapter({ app, origin: 'http://happier-connect.test' });
    const claims = Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct-codex' })).toString('base64url');
    // The provider's OAuth endpoints are the boundary; the command's own login flow runs for real.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === OPENAI_CODEX_DEVICE_USER_CODE_URL) {
        return Response.json({ device_auth_id: 'device', user_code: 'CODE', interval: '1' });
      }
      if (url === OPENAI_CODEX_DEVICE_TOKEN_URL) {
        return Response.json({ authorization_code: 'code', code_verifier: 'verifier' });
      }
      if (url === OPENAI_CODEX_OAUTH_TOKEN_URL) {
        return Response.json({ id_token: `e30.${claims}.sig`, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    }));
    // Paste mode prints the authorization URL; the pasted redirect hands its state back.
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      printed.push(args.join(' '));
    });
    promptInputMock.mockImplementation(async () => {
      const state = new URL(printed.find((line) => line.includes('state=')) ?? '').searchParams.get('state');
      return `http://localhost:1455/auth/callback?code=code&state=${state}`;
    });
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
      await expect(handleConnectCommand(['codex', flag, '--no-open'])).rejects.toThrow('process.exit:0');

      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        content: {
          t: 'plain',
          v: {
            serviceId: 'openai-codex',
            profileId: 'default',
            kind: 'oauth',
            oauth: { providerAccountId: 'acct-codex', raw: { credentialOrigin: 'fresh_authorization' } },
          },
        },
      });
    } finally {
      exitSpy.mockRestore();
      restoreAxios();
      await app.close();
    }
  });
});
