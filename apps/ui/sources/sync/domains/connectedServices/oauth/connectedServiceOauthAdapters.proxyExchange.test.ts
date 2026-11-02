import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectedServiceIdSchema, decodeBase64, encodeBase64, sealBoxBundle } from '@piggercode/protocol';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const credentials = { token: 't', secret: 's' };

function buildBundle(params: Readonly<{ publicKeyB64Url: string; payload: unknown }>): string {
  const recipientPublicKey = decodeBase64(params.publicKeyB64Url, 'base64url');
  const plaintext = new TextEncoder().encode(JSON.stringify(params.payload));
  const bundle = sealBoxBundle({
    plaintext,
    recipientPublicKey,
    randomBytes: (length) => new Uint8Array(length).fill(7),
  });
  return encodeBase64(bundle, 'base64url');
}

describe('ConnectedServiceOauthAdapters (proxy exchange)', () => {
  it('exchanges openai-codex codes via proxy and returns an oauth record', async () => {

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = new URL(String(input)).pathname;
      if (url === '/v1/features') return new Response(JSON.stringify(createRootLayoutFeaturesResponse({ capabilities: { connectedServices: { credentialDelete: { revisionGuard: false }, credentialWrite: { revisionGuard: false }, supportedServiceIds: [...ConnectedServiceIdSchema.options] } } })), { status: 200, headers: { 'content-type': 'application/json' } });
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/health') && method === 'GET') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/v1/auth/ping') && method === 'GET') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/v2/connect/openai-codex/oauth/exchange') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const bundle = buildBundle({
          publicKeyB64Url: String(body.publicKey ?? ''),
          payload: {
            serviceId: 'openai-codex',
            accessToken: 'acc',
            refreshToken: 'ref',
            idToken: 'id',
            scope: null,
            tokenType: null,
            providerEmail: null,
            providerAccountId: 'acct_123',
            expiresAt: 1234,
            raw: null,
          },
        });
        return new Response(JSON.stringify({ bundle }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { getServerFeaturesSnapshot, resetServerFeaturesClientForTests } = await import('@/sync/api/capabilities/serverFeaturesClient');
    resetServerFeaturesClientForTests();
    const supported = await getServerFeaturesSnapshot({ force: true });
    expect(supported.status).toBe('ready');
    const { getConnectedServiceOauthAdapter } = await import('./connectedServiceOauthAdapters');
    const adapter = getConnectedServiceOauthAdapter('openai-codex');
    expect(adapter).not.toBeNull();

    const record = await adapter!.exchangeAuthorizationCodeForRecord({
      credentials,
      profileId: 'work',
      code: 'code',
      verifier: 'verifier',
      redirectUri: 'http://localhost/cb',
      state: 'state',
      now: 1,
    });

    expect(record.kind).toBe('oauth');
    expect(record.serviceId).toBe('openai-codex');
    expect(record.profileId).toBe('work');
    if (record.kind === 'oauth') {
      expect(record.oauth.accessToken).toBe('acc');
      expect(record.oauth.refreshToken).toBe('ref');
      expect(record.oauth.idToken).toBe('id');
      expect(record.oauth.providerAccountId).toBe('acct_123');
    }
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/v2/connect/openai-codex/oauth/exchange'))).toBe(true);
  });

});
