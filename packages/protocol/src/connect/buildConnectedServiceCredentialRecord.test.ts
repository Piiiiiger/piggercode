import { describe, expect, it } from 'vitest';

import {
  buildConnectedServiceCredentialRecord,
  findConnectedServiceEnrollmentConflict,
  isConnectedServiceCredentialOriginVerified,
  readConnectedServiceCredentialOrigin,
  withConnectedServiceCredentialOrigin,
  type ConnectedServiceOauthCredentialRawMetadata,
} from './buildConnectedServiceCredentialRecord';

function rawFromUntypedCaller(value: unknown): ConnectedServiceOauthCredentialRawMetadata {
  // Boundary fixture: simulates a JS caller bypassing TypeScript excess-property checks.
  return value as ConnectedServiceOauthCredentialRawMetadata;
}

describe('buildConnectedServiceCredentialRecord', () => {
  it('builds an oauth record for codex tokens', () => {
    const now = 1700000000000;
    const rec = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'acct_1',
        providerEmail: 'user@example.com',
      },
    });

    expect(rec).toEqual({
      v: 1,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: 'id',
        scope: null,
        tokenType: null,
        providerAccountId: 'acct_1',
        providerEmail: 'user@example.com',
        raw: null,
      },
      token: null,
    });
  });

  it('preserves oauth raw provider metadata when provided', () => {
    const now = 1700000000000;
    const rec = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'default',
      kind: 'oauth',
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: 'user:inference user:profile user:sessions:claude_code',
        tokenType: 'Bearer',
        providerAccountId: null,
        providerEmail: null,
        raw: {
          claudeAiOauth: {
            subscriptionType: 'max',
            rateLimitTier: 'max_20x',
            organizationUuid: 'organization-id',
          },
        },
      },
    });

    expect(rec.oauth?.raw).toEqual({
      claudeAiOauth: {
        subscriptionType: 'max',
        rateLimitTier: 'max_20x',
        organizationUuid: 'organization-id',
      },
    });
  });

  it('canonicalizes legacy Claude OAuth raw metadata into the safe provider metadata shape', () => {
    const now = 1700000000000;
    const rec = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'default',
      kind: 'oauth',
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: 'user:inference user:profile user:sessions:claude_code',
        tokenType: 'Bearer',
        providerAccountId: null,
        providerEmail: null,
        raw: rawFromUntypedCaller({
          'claude.ai_oauth': {
            subscriptionType: ' team ',
            rateLimitTier: 'team_5x',
            access_token: 'must-not-persist',
          },
        }),
      },
    });

    expect(rec.oauth?.raw).toEqual({
      claudeAiOauth: {
        subscriptionType: 'team',
        rateLimitTier: 'team_5x',
      },
    });
    expect(JSON.stringify(rec.oauth?.raw)).not.toContain('access-token');
  });

  it('strips secret-like and arbitrary oauth raw fields before persistence', () => {
    const now = 1700000000000;
    const rec = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'default',
      kind: 'oauth',
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: 'user:inference user:profile user:sessions:claude_code',
        tokenType: 'Bearer',
        providerAccountId: null,
        providerEmail: null,
        raw: rawFromUntypedCaller({
          access_token: 'raw-access-token',
          refresh_token: 'raw-refresh-token',
          id_token: 'raw-id-token',
          authorization: 'Bearer raw-authorization',
          arbitrary: { nested: true },
          claudeAiOauth: {
            subscriptionType: 'max',
            rateLimitTier: 'max_20x',
            access_token: 'nested-access-token',
            refresh_token: 'nested-refresh-token',
            id_token: 'nested-id-token',
            authorization: 'Bearer nested-authorization',
            arbitrary: { nested: true },
          },
        }),
      },
    });

    expect(rec.oauth?.raw).toEqual({
      claudeAiOauth: {
        subscriptionType: 'max',
        rateLimitTier: 'max_20x',
      },
    });
    expect(JSON.stringify(rec.oauth?.raw)).not.toContain('access-token');
    expect(JSON.stringify(rec.oauth?.raw)).not.toContain('refresh-token');
    expect(JSON.stringify(rec.oauth?.raw)).not.toContain('raw-id-token');
    expect(JSON.stringify(rec.oauth?.raw)).not.toContain('authorization');
    expect(JSON.stringify(rec.oauth?.raw)).not.toContain('nested');
  });

  it('drops oauth raw metadata when only secret-like or arbitrary fields are present', () => {
    const now = 1700000000000;
    const rec = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'default',
      kind: 'oauth',
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: 'user:inference user:profile user:sessions:claude_code',
        tokenType: 'Bearer',
        providerAccountId: null,
        providerEmail: null,
        raw: rawFromUntypedCaller({
          access_token: 'raw-access-token',
          refresh_token: 'raw-refresh-token',
          id_token: 'raw-id-token',
          authorization: 'Bearer raw-authorization',
          arbitrary: { nested: true },
          claudeAiOauth: {
            access_token: 'nested-access-token',
            arbitrary: { nested: true },
          },
        }),
      },
    });

    expect(rec.oauth?.raw).toBeNull();
  });

  it('builds a token record for setup-token credentials', () => {
    const now = 1700000000000;
    const rec = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'anthropic',
      profileId: 'default',
      kind: 'token',
      token: {
        token: 'setup-token',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    expect(rec.kind).toBe('token');
    expect(rec.serviceId).toBe('anthropic');
    expect(rec.expiresAt).toBeNull();
  });

  function codexRecord(raw: unknown) {
    return buildConnectedServiceCredentialRecord({
      now: 1700000000000,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      oauth: {
        accessToken: 'at',
        refreshToken: 'rt',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct_1',
        providerEmail: null,
        raw: rawFromUntypedCaller(raw),
      },
    });
  }

  it('keeps the fresh-authorization origin and drops any other origin value', () => {
    const fresh = codexRecord({ credentialOrigin: 'fresh_authorization' });
    expect(fresh.kind === 'oauth' ? fresh.oauth.raw : null).toEqual({ credentialOrigin: 'fresh_authorization' });
    expect(readConnectedServiceCredentialOrigin(fresh)).toBe('fresh_authorization');

    const imported = codexRecord({ credentialOrigin: 'imported' });
    expect(imported.kind === 'oauth' ? imported.oauth.raw : undefined).toBeNull();
    expect(readConnectedServiceCredentialOrigin(imported)).toBeNull();
  });

  it('carries the origin over when provider metadata replaces the raw value', () => {
    const replaced = withConnectedServiceCredentialOrigin({
      previousRaw: { credentialOrigin: 'fresh_authorization' },
      nextRaw: { claudeAiOauth: { subscriptionType: 'max' } },
    });
    expect(replaced).toEqual({ claudeAiOauth: { subscriptionType: 'max' }, credentialOrigin: 'fresh_authorization' });
    expect(withConnectedServiceCredentialOrigin({ previousRaw: null, nextRaw: { claudeAiOauth: { subscriptionType: 'max' } } }))
      .toEqual({ claudeAiOauth: { subscriptionType: 'max' } });
    expect(withConnectedServiceCredentialOrigin({ previousRaw: { credentialOrigin: 'fresh_authorization' }, nextRaw: null }))
      .toEqual({ credentialOrigin: 'fresh_authorization' });
  });

  it('requires a fresh authorization only where a native login would rotate the same grant', () => {
    expect(isConnectedServiceCredentialOriginVerified(codexRecord({ credentialOrigin: 'fresh_authorization' }))).toBe(true);
    expect(isConnectedServiceCredentialOriginVerified(codexRecord(null))).toBe(false);
    const claudeSetupToken = buildConnectedServiceCredentialRecord({
      now: 1700000000000,
      serviceId: 'claude-subscription',
      profileId: 'default',
      kind: 'token',
      token: { token: 'setup-token', providerAccountId: null, providerEmail: null },
    });
    expect(isConnectedServiceCredentialOriginVerified(claudeSetupToken)).toBe(false);
    const openAiApiKey = buildConnectedServiceCredentialRecord({
      now: 1700000000000,
      serviceId: 'openai',
      profileId: 'default',
      kind: 'token',
      token: { token: 'sk-test', providerAccountId: null, providerEmail: null },
    });
    expect(isConnectedServiceCredentialOriginVerified(openAiApiKey)).toBe(true);
  });

  it('finds another profile that already holds the same subscription account', async () => {
    const record = codexRecord({ credentialOrigin: 'fresh_authorization' }); // profile 'work', account acct_1
    await expect(findConnectedServiceEnrollmentConflict({
      record,
      readProfiles: async () => [{ profileId: 'work', providerAccountId: 'acct_1' }, { profileId: 'other', providerAccountId: 'acct_2' }],
    })).resolves.toBeNull(); // re-authorizing the same profile
    await expect(findConnectedServiceEnrollmentConflict({
      record,
      readProfiles: async () => [{ profileId: 'personal', providerAccountId: 'acct_1' }],
    })).resolves.toEqual({ kind: 'duplicate', existingProfileId: 'personal' });
    const unnamed = buildConnectedServiceCredentialRecord({
      now: 1700000000000, serviceId: 'openai-codex', profileId: 'work', kind: 'oauth',
      oauth: { accessToken: 'at', refreshToken: 'rt', idToken: null, scope: null, tokenType: null,
        providerAccountId: null, providerEmail: null, raw: { credentialOrigin: 'fresh_authorization' } },
    });
    // Only a named subscription login depends on the list being readable.
    const unavailable = async () => { throw new Error('profiles unavailable'); };
    await expect(findConnectedServiceEnrollmentConflict({ record: unnamed, readProfiles: unavailable }))
      .resolves.toEqual({ kind: 'unidentified' });
    const apiKey = buildConnectedServiceCredentialRecord({
      now: 1700000000000, serviceId: 'openai', profileId: 'work', kind: 'token',
      token: { token: 'sk-test', providerAccountId: 'acct_1', providerEmail: null },
    });
    await expect(findConnectedServiceEnrollmentConflict({ record: apiKey, readProfiles: unavailable })).resolves.toBeNull();
  });
});
