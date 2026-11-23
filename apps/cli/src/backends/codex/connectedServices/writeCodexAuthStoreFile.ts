import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ConnectedServiceCredentialRecordV1 } from '@piggercode/protocol';

import { requireConnectedServiceOauthCredentialRecord } from '@/daemon/connectedServices/shared/connectedServiceCredentialRecord';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import { withConnectedServiceStateSharingLocks } from '@/daemon/connectedServices/stateSharing/connectedServiceStateSharingLock';
import type { ConnectedServiceSharedGenerationMutationCurrentness } from '@/daemon/connectedServices/credentials/lifecycleTypes';

async function readProjectionJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The token set PiggerCode projects into `auth.json`, in the order its fingerprint is taken. */
export type CodexAuthStoreTokens = Readonly<{
  access_token: string;
  refresh_token: string;
  id_token: string | null;
  account_id: string | null;
}>;

function fingerprintTokens(tokens: CodexAuthStoreTokens): string {
  const ordered = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    account_id: tokens.account_id,
  };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function sourceProjection(record: ConnectedServiceCredentialRecordV1) {
  const credential = requireConnectedServiceOauthCredentialRecord(record);
  const tokens: CodexAuthStoreTokens = {
    access_token: credential.oauth.accessToken,
    refresh_token: credential.oauth.refreshToken,
    id_token: credential.oauth.idToken,
    account_id: credential.oauth.providerAccountId,
  };
  return { tokens, fingerprint: fingerprintTokens(tokens) };
}

const PROJECTION_FILE = '.happier-auth-projection.json';

/** The tokens the native client currently keeps in `auth.json`, when they are usable. */
async function readNativeTokens(codexHome: string): Promise<CodexAuthStoreTokens | null> {
  // Only a file the native client could have written (it records `last_refresh` as RFC 3339) holds a
  // rotation; anything else is damage the writer repairs.
  const existing = asRecord(await readProjectionJson(join(codexHome, 'auth.json')));
  const tokens = asRecord(existing?.tokens);
  if (!tokens || typeof existing?.last_refresh !== 'string' || !Number.isFinite(Date.parse(existing.last_refresh))) return null;
  const { access_token: accessToken, refresh_token: refreshToken, id_token: idToken, account_id: accountId } = tokens;
  if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: typeof idToken === 'string' && idToken ? idToken : null,
    account_id: typeof accountId === 'string' && accountId ? accountId : null,
  };
}

/**
 * What PiggerCode last accounted for in this home: `fingerprint` is the token set the relay is known
 * to hold (projected here, or a rotation read back), `uploading` the rotations whose upload started
 * against it but was not confirmed. The relay may take any of them even so (an answer lost, a write
 * that lands after it timed out), until a later read-back sees which one it holds.
 */
async function readProjectionMarker(codexHome: string): Promise<Readonly<{ fingerprint: string | null; uploading: ReadonlyArray<string> }>> {
  const projection = asRecord(await readProjectionJson(join(codexHome, PROJECTION_FILE)));
  const uploading = projection?.uploading;
  return {
    fingerprint: typeof projection?.fingerprint === 'string' ? projection.fingerprint : null,
    uploading: Array.isArray(uploading)
      ? uploading.filter((entry): entry is string => typeof entry === 'string')
      : typeof uploading === 'string' ? [uploading] : [],
  };
}

async function readProjectedFingerprint(codexHome: string): Promise<string | null> {
  return (await readProjectionMarker(codexHome)).fingerprint;
}

/**
 * The native client rotated the login since PiggerCode last wrote it, and that rotation is not yet in
 * the relay: its refresh token is the only valid one, so nothing may overwrite it.
 */
async function readUnsyncedNativeRotation(
  codexHome: string,
  accountId: string | null,
): Promise<CodexAuthStoreTokens | null> {
  const projected = await readProjectedFingerprint(codexHome);
  const native = await readNativeTokens(codexHome);
  if (!projected || !native || native.account_id !== accountId) return null;
  return fingerprintTokens(native) === projected ? null : native;
}

async function matchesSourceProjection(codexHome: string, source: ReturnType<typeof sourceProjection>): Promise<boolean> {
  const projection = asRecord(await readProjectionJson(join(codexHome, PROJECTION_FILE)));
  const existing = asRecord(await readProjectionJson(join(codexHome, 'auth.json')));
  const tokens = asRecord(existing?.tokens);
  return projection?.fingerprint === source.fingerprint
    && existing?.auth_mode === 'chatgpt'
    && typeof existing.last_refresh === 'string' && Number.isFinite(Date.parse(existing.last_refresh))
    && tokens?.account_id === source.tokens.account_id
    && typeof tokens.access_token === 'string' && tokens.access_token.length > 0
    && typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0;
}

/** Prove daemon preparation without rewriting tokens that native disk-auth clients rotated. */
export async function isCodexAuthStoreProjectionCurrent(params: Readonly<{
  codexHome: string;
  record: ConnectedServiceCredentialRecordV1;
}>): Promise<boolean> {
  const source = sourceProjection(params.record);
  return await withConnectedServiceStateSharingLocks([params.codexHome],
    async () => await matchesSourceProjection(params.codexHome, source), { providerId: 'codex' });
}

/**
 * Canonical writer for the Codex auth store (`<codexHome>/auth.json`).
 *
 * Disk-auth launches consume this projection. External-token app-server auth is process-local;
 * selection materialization persists the selected binding here for later launches, not reconnects.
 */
export async function writeCodexAuthStoreFile(params: Readonly<{
  codexHome: string;
  record: ConnectedServiceCredentialRecordV1;
  validateCurrentBeforeMutation?: () => Promise<ConnectedServiceSharedGenerationMutationCurrentness>;
  /**
   * For a short-lived probe home: without the refresh token the probe's client cannot rotate the
   * login, so it never spends the token that a session or the relay holds.
   */
  withoutRefreshToken?: boolean;
}>): Promise<boolean> {
  const source = sourceProjection(params.record);
  const tokens: CodexAuthStoreTokens = params.withoutRefreshToken ? { ...source.tokens, refresh_token: '' } : source.tokens;
  const fingerprint = params.withoutRefreshToken ? fingerprintTokens(tokens) : source.fingerprint;
  const projectionPath = join(params.codexHome, PROJECTION_FILE);
  return await withConnectedServiceStateSharingLocks([params.codexHome], async () => {
    if (params.validateCurrentBeforeMutation && !(await params.validateCurrentBeforeMutation()).current) return false;
    // Compare the last Happier source, not the mutable native file: native disk-auth clients can
    // rotate it independently. Unchanged source must not roll a newer native refresh token back.
    if (await matchesSourceProjection(params.codexHome, { tokens, fingerprint })) return true;
    // Nor may a changed source: until the native rotation is read back (or deliberately superseded
    // by the refresh owner), the native refresh token is the only valid one for this account.
    if (await readUnsyncedNativeRotation(params.codexHome, tokens.account_id)) return true;
    await writeJsonAtomic(join(params.codexHome, 'auth.json'), {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      ...tokens,
      // Match Codex CLI expectations while keeping our existing flat format for backward compatibility.
      tokens,
      last_refresh: new Date().toISOString(),
    });
    await writeJsonAtomic(projectionPath, { v: 1, fingerprint });
    return true;
  }, { providerId: 'codex' });
}

export type CodexAuthStoreRotation =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'rotated';
      tokens: CodexAuthStoreTokens;
      /**
       * The relay holds what PiggerCode last accounted for here (projected, read back, or an upload
       * whose answer was lost), so the rotation is newer than the relay's login.
       */
      sourceUnchanged: boolean;
    }>;

/** Reads a rotation the native client made since PiggerCode last wrote this home for `record`'s account. */
export async function readCodexAuthStoreRotation(params: Readonly<{
  codexHome: string;
  record: ConnectedServiceCredentialRecordV1;
}>): Promise<CodexAuthStoreRotation> {
  const source = sourceProjection(params.record);
  return await withConnectedServiceStateSharingLocks([params.codexHome], async () => {
    const native = await readUnsyncedNativeRotation(params.codexHome, source.tokens.account_id);
    if (!native) return { kind: 'none' } as const;
    const marker = await readProjectionMarker(params.codexHome);
    const uploadReachedRelay = marker.uploading.includes(source.fingerprint);
    if (uploadReachedRelay && fingerprintTokens(native) === source.fingerprint) {
      // The relay took this very rotation although the daemon never heard so: nothing left to upload.
      await writeJsonAtomic(join(params.codexHome, PROJECTION_FILE), { v: 1, fingerprint: source.fingerprint });
      return { kind: 'none' } as const;
    }
    return {
      kind: 'rotated',
      tokens: native,
      sourceUnchanged: marker.fingerprint === source.fingerprint || uploadReachedRelay,
    } as const;
  }, { providerId: 'codex' });
}

/**
 * Records, before a rotation is uploaded, that the relay may take `tokens` even if no answer arrives.
 * `base` is the relay credential the upload is compare-and-set against: the relay holds it now, so it is
 * the accounted-for base. While the base is unchanged, earlier uploads against it are still unresolved
 * (one may land after it timed out) and stay recorded; once the relay moved on, they can no longer land.
 */
export async function markCodexAuthStoreRotationUploading(params: Readonly<{
  codexHome: string;
  tokens: CodexAuthStoreTokens;
  base: ConnectedServiceCredentialRecordV1;
}>): Promise<void> {
  await withConnectedServiceStateSharingLocks([params.codexHome], async () => {
    const marker = await readProjectionMarker(params.codexHome);
    const baseFingerprint = sourceProjection(params.base).fingerprint;
    const unresolved = marker.fingerprint === baseFingerprint ? marker.uploading : [];
    const attempt = fingerprintTokens(params.tokens);
    await writeJsonAtomic(join(params.codexHome, PROJECTION_FILE), {
      v: 1,
      fingerprint: baseFingerprint,
      uploading: unresolved.includes(attempt) ? unresolved : [...unresolved, attempt],
    });
  }, { providerId: 'codex' });
}

/**
 * Records that `tokens` are accounted for: uploaded to the relay, or superseded by a newer relay
 * credential the refresh owner chose to keep. Later writes may then replace them again.
 */
export async function markCodexAuthStoreRotationSynced(params: Readonly<{
  codexHome: string;
  tokens: CodexAuthStoreTokens;
}>): Promise<void> {
  await withConnectedServiceStateSharingLocks([params.codexHome], async () => {
    await writeJsonAtomic(join(params.codexHome, PROJECTION_FILE), { v: 1, fingerprint: fingerprintTokens(params.tokens) });
  }, { providerId: 'codex' });
}
