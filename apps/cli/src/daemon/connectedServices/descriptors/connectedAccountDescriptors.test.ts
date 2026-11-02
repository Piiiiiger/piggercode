import { describe, expect, it } from 'vitest';

import { CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE } from '@piggercode/agents';

function buildJwt(payload: Record<string, unknown>): string {
  return [
    'hdr',
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    'sig',
  ].join('.');
}

describe('connected account descriptors', () => {
  it('uses one provider profile read to attest context and rejects another user identity', async () => {
    const { fetchClaudeSubscriptionProfileContext } = await import('./connectedAccountDescriptors');
    const payload = { account: { uuid: 'user', email_address: 'member@example.test' }, organization: { uuid: 'organization' } };
    const fetcher: typeof fetch = async () => Response.json(payload);
    expect(await fetchClaudeSubscriptionProfileContext({ accessToken: 'access', expectedProviderAccountId: 'user', fetcher }))
      .toMatchObject({ status: 'accepted', providerAccountId: 'user', raw: { claudeAiOauth: { organizationUuid: 'organization' } } });
    expect(await fetchClaudeSubscriptionProfileContext({ accessToken: 'access', expectedProviderAccountId: 'another-user', fetcher }))
      .toEqual({ status: 'identity_mismatch' });
    expect(await fetchClaudeSubscriptionProfileContext({ accessToken: 'access', expectedProviderAccountId: 'user',
      fetcher: async () => Response.json({ organization: { uuid: 'unbound-organization' } }) }))
      .toEqual({ status: 'unavailable' });
  });
  const claudeCodeScopeString = CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE;

  it('exposes Claude Code OAuth scopes through the daemon descriptor config', async () => {
    const mod = await import('./connectedAccountDescriptors');

    const descriptor = mod.requireConnectedAccountDescriptor('claude-subscription');
    expect(descriptor.oauth?.scopes).toEqual(claudeCodeScopeString.split(' '));
    expect(mod.resolveConnectedAccountOauthConfig('claude-subscription', {}).scopes.join(' ')).toBe(claudeCodeScopeString);
  });

  it('keeps Claude subscription OAuth scopes aligned with the shared Claude Code scope source', async () => {
    const mod = await import('./connectedAccountDescriptors');
    const agents = await import('@piggercode/agents');

    expect(mod.CLAUDE_SUBSCRIPTION_OAUTH_SCOPES).toEqual(agents.CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPES);
    expect(mod.CLAUDE_SUBSCRIPTION_OAUTH_SCOPE).toBe(agents.CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE);
    expect(mod.CLAUDE_SUBSCRIPTION_REQUIRED_CLAUDE_CODE_SCOPES).toEqual(
      agents.CLAUDE_CODE_REQUIRED_OAUTH_SCOPES,
    );
  });

  it('maps Claude OAuth expires_in to a millisecond epoch for native Claude Code credentials', async () => {
    const mod = await import('./connectedAccountDescriptors');
    const descriptor = mod.requireConnectedAccountDescriptor('claude-subscription');
    const issuedAtMs = Date.parse('2026-06-05T12:00:00.000Z');
    const mapped = descriptor.oauth?.mapCredentialPayload({
      now: issuedAtMs,
      payload: {
        access_token: 'access',
        refresh_token: 'refresh',
        scope: claudeCodeScopeString,
        expires_in: 3600,
      },
    });

    expect(mapped?.expiresAt).toBe(issuedAtMs + 60 * 60 * 1000);
    expect(mapped?.expiresAt).toBeGreaterThan(1_000_000_000_000);
  });

  it('maps Claude subscription tier metadata into raw native OAuth materialization data', async () => {
    const mod = await import('./connectedAccountDescriptors');
    const descriptor = mod.requireConnectedAccountDescriptor('claude-subscription');
    const mapped = descriptor.oauth?.mapCredentialPayload({
      now: 1_000,
      payload: {
        access_token: 'access',
        refresh_token: 'refresh',
        scope: claudeCodeScopeString,
        subscription_type: 'max',
        rate_limit_tier: 'max_20x',
        organization: { uuid: 'organization-id' },
      },
    });

    expect(mapped?.raw).toEqual({
      claudeAiOauth: {
        subscriptionType: 'max',
        rateLimitTier: 'max_20x',
        organizationUuid: 'organization-id',
      },
    });
  });

  it('excludes token response secrets from Claude raw native OAuth metadata', async () => {
    const mod = await import('./connectedAccountDescriptors');
    const descriptor = mod.requireConnectedAccountDescriptor('claude-subscription');
    const mapped = descriptor.oauth?.mapCredentialPayload({
      now: 1_000,
      payload: {
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        id_token: 'id-secret',
        authorization: 'Bearer auth-secret',
        scope: claudeCodeScopeString,
        subscription_type: 'max',
        rate_limit_tier: 'max_20x',
        arbitrary: { nested: true },
        claudeAiOauth: {
          access_token: 'nested-access-secret',
          refresh_token: 'nested-refresh-secret',
          id_token: 'nested-id-secret',
          authorization: 'Bearer nested-auth-secret',
          arbitrary: { nested: true },
        },
      },
    });

    expect(mapped?.raw).toEqual({
      claudeAiOauth: {
        subscriptionType: 'max',
        rateLimitTier: 'max_20x',
      },
    });
    expect(JSON.stringify(mapped?.raw)).not.toContain('secret');
    expect(JSON.stringify(mapped?.raw)).not.toContain('authorization');
    expect(JSON.stringify(mapped?.raw)).not.toContain('nested');
  });

  it('maps OpenAI Codex OAuth id_token claims to friendly account identity', async () => {
    const mod = await import('./connectedAccountDescriptors');
    const descriptor = mod.requireConnectedAccountDescriptor('openai-codex');
    const mapped = descriptor.oauth?.mapCredentialPayload({
      now: 1_000,
      payload: {
        access_token: 'access',
        refresh_token: 'refresh',
        id_token: buildJwt({
          chatgpt_account_id: 'acct-from-token',
          email: 'codex-user@example.test',
        }),
        expires_in: 60,
      },
    });

    expect(mapped).toMatchObject({
      providerAccountId: 'acct-from-token',
      providerEmail: 'codex-user@example.test',
    });
  });

  it('resolves provider-facing display names from the descriptor catalog', async () => {
    const mod = await import('./connectedAccountDescriptors');

    expect(mod.resolveConnectedServiceProviderDisplayName('openai-codex')).toBe('OpenAI');
    expect(mod.resolveConnectedServiceProviderDisplayName('claude-subscription')).toBe('Claude');
    expect(mod.resolveConnectedServiceProviderDisplayName('claude-subscription', 'Claude subscription')).toBe('Claude');
    expect(mod.resolveConnectedServiceProviderDisplayName('unknown-service')).toBe('Provider');
  });
});
