import {
  ConnectedServiceCredentialRecordV1Schema,
  type ConnectedServiceCredentialRecordV1,
  type ConnectedServiceId,
} from './connectedServiceSchemas.js';
import { readClaudeOauthCredentialMetadata, readClaudeOauthCredentialOrganizationId, type ClaudeOauthCredentialMetadata } from '../providers/claude/oauthProfile.js';

/**
 * Marks a credential that PiggerCode obtained through its own authorization (device code or OAuth
 * grant). A copied native login shares its refresh token with the native client, which keeps
 * rotating it, so only a fresh authorization may be refreshed or launched by PiggerCode.
 */
export type ConnectedServiceCredentialOrigin = 'fresh_authorization';

export type ConnectedServiceOauthCredentialRawMetadata = Readonly<{
  claudeAiOauth?: ClaudeOauthCredentialMetadata;
  'claude.ai_oauth'?: ClaudeOauthCredentialMetadata;
  credentialOrigin?: ConnectedServiceCredentialOrigin;
}>;

function readCredentialOriginFromRaw(raw: unknown): ConnectedServiceCredentialOrigin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return (raw as Readonly<Record<string, unknown>>).credentialOrigin === 'fresh_authorization'
    ? 'fresh_authorization'
    : null;
}

export function normalizeConnectedServiceOauthCredentialRawMetadata(
  raw: unknown,
  _serviceId?: ConnectedServiceId,
): ConnectedServiceOauthCredentialRawMetadata | null {
  const claudeAiOauth = readClaudeOauthCredentialMetadata(raw);
  const credentialOrigin = readCredentialOriginFromRaw(raw);
  const normalized = {
    ...(claudeAiOauth ? { claudeAiOauth } : {}),
    ...(credentialOrigin ? { credentialOrigin } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function readConnectedServiceCredentialOrigin(
  record: ConnectedServiceCredentialRecordV1,
): ConnectedServiceCredentialOrigin | null {
  return record.kind === 'oauth' ? readCredentialOriginFromRaw(record.oauth.raw) : null;
}

/**
 * Keeps the origin of the grant when a rotation or provider lookup replaces the raw metadata: the
 * same grant keeps its origin; only a new authorization or a replacement credential may change it.
 */
export function withConnectedServiceCredentialOrigin(input: Readonly<{
  previousRaw: unknown;
  nextRaw: unknown;
}>): ConnectedServiceOauthCredentialRawMetadata | null {
  const next = normalizeConnectedServiceOauthCredentialRawMetadata(input.nextRaw);
  const credentialOrigin = readCredentialOriginFromRaw(input.previousRaw);
  if (!credentialOrigin) return next;
  return { ...(next ?? {}), credentialOrigin };
}

/**
 * Subscription logins carry a refresh token that rotates on every use, so whoever else holds it
 * (a native CLI login, another machine) invalidates PiggerCode's copy. Only a fresh PiggerCode
 * authorization may be used, and only the account's managing machine may act on it.
 */
export function isConnectedServiceSubscriptionLogin(serviceId: ConnectedServiceId): boolean {
  return serviceId === 'openai-codex' || serviceId === 'claude-subscription';
}

export type ConnectedServiceEnrollmentConflict =
  | Readonly<{ kind: 'duplicate'; existingProfileId: string }>
  /** The provider did not name the account, so a second enrollment of it could not be recognized. */
  | Readonly<{ kind: 'unidentified' }>;

/**
 * A subscription login is connected once: another profile holding the same provider account would
 * count one account twice in a pool. Re-authorizing the same profile is allowed.
 */
export async function findConnectedServiceEnrollmentConflict(input: Readonly<{
  record: ConnectedServiceCredentialRecordV1;
  /** Read only when the check needs it, so no other kind of credential depends on the list being readable. */
  readProfiles: () => Promise<ReadonlyArray<Readonly<{ profileId: string; providerAccountId?: string | null }>>>;
}>): Promise<ConnectedServiceEnrollmentConflict | null> {
  if (input.record.kind !== 'oauth' || !isConnectedServiceSubscriptionLogin(input.record.serviceId)) return null;
  const accountId = input.record.oauth.providerAccountId;
  if (!accountId) return { kind: 'unidentified' };
  const existingProfileId = (await input.readProfiles()).find((profile) => (
    profile.profileId !== input.record.profileId && profile.providerAccountId === accountId
  ))?.profileId;
  return existingProfileId ? { kind: 'duplicate', existingProfileId } : null;
}

/** Whether PiggerCode may refresh this credential or launch a session with it. */
export function isConnectedServiceCredentialOriginVerified(record: ConnectedServiceCredentialRecordV1): boolean {
  if (!isConnectedServiceSubscriptionLogin(record.serviceId)) return true;
  return readConnectedServiceCredentialOrigin(record) === 'fresh_authorization';
}

export function buildConnectedServiceCredentialRecord(
  params:
    | Readonly<{
        now: number;
        serviceId: ConnectedServiceId;
        profileId: string;
        kind: 'oauth';
        expiresAt?: number | null;
        oauth: Readonly<{
          accessToken: string;
          refreshToken: string;
          idToken: string | null;
          scope: string | null;
          tokenType: string | null;
          providerAccountId: string | null;
          providerEmail: string | null;
          raw?: ConnectedServiceOauthCredentialRawMetadata | null;
        }>;
      }>
    | Readonly<{
        now: number;
        serviceId: ConnectedServiceId;
        profileId: string;
        kind: 'token';
        token: Readonly<{
          token: string;
          providerAccountId: string | null;
          providerEmail: string | null;
        }>;
      }>,
): ConnectedServiceCredentialRecordV1 {
  const base = {
    v: 1 as const,
    serviceId: params.serviceId,
    profileId: params.profileId,
    createdAt: params.now,
    updatedAt: params.now,
    expiresAt: params.kind === 'oauth' ? (params.expiresAt ?? null) : null,
  };

  const record: unknown =
    params.kind === 'oauth'
      ? {
          ...base,
          kind: 'oauth' as const,
          oauth: {
            accessToken: params.oauth.accessToken,
            refreshToken: params.oauth.refreshToken,
            idToken: params.oauth.idToken,
            scope: params.oauth.scope,
            tokenType: params.oauth.tokenType,
            providerAccountId: params.oauth.providerAccountId,
            providerEmail: params.oauth.providerEmail,
            raw: normalizeConnectedServiceOauthCredentialRawMetadata(params.oauth.raw, params.serviceId),
          },
          token: null,
        }
      : {
          ...base,
          kind: 'token' as const,
          oauth: null,
          token: {
            token: params.token.token,
            providerAccountId: params.token.providerAccountId,
            providerEmail: params.token.providerEmail,
            raw: null,
          },
        };

  return ConnectedServiceCredentialRecordV1Schema.parse(record);
}

/** Provider usage identity requirements shared by credential writers and usage consumers. */
export function connectedServiceUsageRequiresOrganizationId(serviceId: ConnectedServiceId): boolean {
  return serviceId === 'claude-subscription';
}

export function readConnectedServiceCredentialOrganizationId(record: ConnectedServiceCredentialRecordV1): string | null {
  return connectedServiceUsageRequiresOrganizationId(record.serviceId) && record.kind === 'oauth'
    ? readClaudeOauthCredentialOrganizationId(record.oauth.raw)
    : null;
}

export type ConnectedServiceCredentialMetadata = Readonly<{
  kind: 'oauth' | 'token';
  providerEmail: string | null;
  providerAccountId: string | null;
  providerOrganizationId?: string | null;
  expiresAt: number | null;
}>;

/** Public, non-secret projection of the credential's attested provider identity. */
export function buildConnectedServiceCredentialMetadata(record: ConnectedServiceCredentialRecordV1): ConnectedServiceCredentialMetadata {
  const identity = record.kind === 'oauth' ? record.oauth : record.token;
  const providerOrganizationId = readConnectedServiceCredentialOrganizationId(record);
  return {
    kind: record.kind,
    providerEmail: identity.providerEmail ?? null,
    providerAccountId: identity.providerAccountId ?? null,
    ...(providerOrganizationId ? { providerOrganizationId } : {}),
    expiresAt: record.expiresAt,
  };
}
