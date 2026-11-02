import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildConnectedServiceCredentialRecord, ConnectedServiceIdSchema } from '@piggercode/protocol';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

describe('Connected Service authoring admission', () => {
  it.each(['openai-codex'] as const)('keeps admitted %s OAuth authoring usable', async (serviceId) => {
    vi.doMock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => ({ serverId: 'test', serverUrl: 'https://api.example.test', generation: 1 }) }));
    vi.doMock('@/auth/storage/tokenStorage', () => ({ TokenStorage: { getCredentials: async () => null } }));
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const payload = path === '/v1/features'
        ? createRootLayoutFeaturesResponse({ capabilities: { connectedServices: { ...createRootLayoutFeaturesResponse().capabilities.connectedServices, supportedServiceIds: [...ConnectedServiceIdSchema.options] } } })
        : { bundle: 'oauth-bundle' };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetch);
    const { exchangeConnectedServiceOauthViaProxy } = await import('./apiConnectedServicesV2');
    await expect(exchangeConnectedServiceOauthViaProxy({ token: 't', secret: 's' }, { serviceId, publicKey: 'pk', code: 'code', verifier: 'verifier', redirectUri: 'https://callback.example.test' })).resolves.toEqual({ bundle: 'oauth-bundle' });
    expect(fetch.mock.calls.some(([input]) => new URL(String(input)).pathname === `/v2/connect/${serviceId}/oauth/exchange`)).toBe(true);
    if (serviceId === 'openai-codex') expect(fetch.mock.calls.some(([input]) => new URL(String(input)).pathname === '/v1/features')).toBe(false);
  });
});
