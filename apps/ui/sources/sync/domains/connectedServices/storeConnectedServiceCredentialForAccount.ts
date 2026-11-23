import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { serverFetch } from '@/sync/http/client';
import { HappyError } from '@/utils/errors/errors';
import { t } from '@/text';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { connectedServiceLoginUse } from '@/sync/ops/connectedServiceLoginUse';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import {
  getCachedReadyServerFeatures,
  getReadyServerFeatures,
} from '@/sync/api/capabilities/getReadyServerFeatures';
import { isReleasedServerV021CompatibilitySnapshot } from '@/sync/api/capabilities/releasedServerV021Compatibility';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import {
  deleteConnectedServiceCredential as deleteConnectedServiceCredentialV2,
  getConnectedServiceCredentialSealed,
  registerConnectedServiceCredentialSealed,
} from '@/sync/api/account/apiConnectedServicesV2';
import {
  deleteConnectedServiceCredentialV3,
  getConnectedServiceCredentialPlain,
  registerConnectedServiceCredentialPlain,
} from '@/sync/api/account/apiConnectedServicesV3';
import {
  ConnectedServiceApiError,
  isConnectedServiceApiErrorCode,
} from '@/sync/api/account/connectedServiceApiError';

import {
  AccountProfileSchema,
  ConnectedServiceCredentialRecordV1Schema,
  DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1,
  buildConnectedServiceCredentialMetadata,
  findConnectedServiceEnrollmentConflict,
  ConnectedServicesManagementV1Schema,
  isConnectedServiceSubscriptionLogin,
  assertConnectedServiceCredentialRecordBinding,
  type AccountProfile,
  type ConnectedServiceCredentialRecordV1,
  type ConnectedServiceCredentialRevisionBoundaryV1,
  type ConnectedServiceCredentialRevisionV1,
  type ConnectedServiceId,
} from '@piggercode/protocol';

import { sealConnectedServiceCredential } from './sealConnectedServiceCredential';
import { invalidateConnectedServiceQuotaSnapshotForCredential } from './connectedServiceQuotaSnapshotStore';

const CREDENTIAL_NOT_FOUND_ERROR = 'connect_credential_not_found';
const PROVIDER_IDENTITY_MISMATCH_ERROR = 'connect_reconnect_provider_identity_mismatch';

type CredentialRevisionGuard = ConnectedServiceCredentialRevisionV1 | null;

export class ConnectedServiceCredentialIdentityMismatchError extends Error {
  readonly code = PROVIDER_IDENTITY_MISMATCH_ERROR;
  readonly canTryAgain = false;

  constructor(
    readonly expectedCredentialRevision: CredentialRevisionGuard,
    cause: unknown,
  ) {
    super(PROVIDER_IDENTITY_MISMATCH_ERROR, { cause });
    this.name = 'ConnectedServiceCredentialIdentityMismatchError';
    Object.setPrototypeOf(this, ConnectedServiceCredentialIdentityMismatchError.prototype);
  }
}

function isAmbiguousCredentialMutationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const failure = error as Readonly<{ canTryAgain?: unknown; status?: unknown; retryable?: unknown }>;
  if (failure.canTryAgain === false || failure.retryable === false) return false;
  if (
    typeof failure.status === 'number'
    && failure.status >= 400
    && failure.status < 500
    && failure.status !== 408
    && failure.status !== 429
  ) {
    return false;
  }
  return true;
}

function supersededCredentialMutation(currentRevision: CredentialRevisionGuard): ConnectedServiceApiError {
  return new ConnectedServiceApiError({
    code: 'connect_credential_mutation_superseded',
    status: 409,
    canTryAgain: false,
    reason: 'revision_mismatch',
    credentialRevision: currentRevision,
  });
}

async function readCurrentOrAbsent<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (isConnectedServiceApiErrorCode(error, CREDENTIAL_NOT_FOUND_ERROR)) return null;
    throw error;
  }
}

function credentialRevisionBoundary(
  value: ConnectedServiceCredentialRevisionBoundaryV1,
): ConnectedServiceCredentialRevisionBoundaryV1 {
  return value.revisionSemantics === 'revisioned'
    ? { revisionSemantics: 'revisioned', credentialRevision: value.credentialRevision }
    : { revisionSemantics: 'legacy_unfenced', credentialRevision: null };
}

async function writeWithAmbiguousSettlement<T>(params: Readonly<{
  expectedCredentialRevision: CredentialRevisionGuard;
  write: () => Promise<ConnectedServiceCredentialRevisionBoundaryV1>;
  readCurrent: () => Promise<(
    Readonly<{ content: T }> & ConnectedServiceCredentialRevisionBoundaryV1
  ) | null>;
  isIntendedContent: (content: T) => boolean;
}>): Promise<ConnectedServiceCredentialRevisionBoundaryV1> {
  const settle = async (
    ambiguousWriteError: unknown,
  ): Promise<ConnectedServiceCredentialRevisionBoundaryV1 | null> => {
    let current: (Readonly<{ content: T }> & ConnectedServiceCredentialRevisionBoundaryV1) | null;
    try {
      current = await params.readCurrent();
    } catch {
      throw ambiguousWriteError;
    }
    if (current && params.isIntendedContent(current.content)) {
      return credentialRevisionBoundary(current);
    }
    if ((current?.credentialRevision ?? null) !== params.expectedCredentialRevision) {
      throw supersededCredentialMutation(current?.credentialRevision ?? null);
    }
    return null;
  };

  try {
    return await params.write();
  } catch (error) {
    if (!isAmbiguousCredentialMutationFailure(error)) throw error;

    const settled = await settle(error);
    if (settled) return settled;

    try {
      return await params.write();
    } catch (retryError) {
      if (!isAmbiguousCredentialMutationFailure(retryError)) throw retryError;

      const retrySettled = await settle(retryError);
      if (retrySettled) return retrySettled;
      throw retryError;
    }
  }
}

/**
 * The account's connected services, read once from the relay for a decision (another device may have
 * just added one). Rejects on any failure, including a body that does not parse: an empty list must mean
 * nothing is connected.
 */
export async function fetchConnectedServicesInventory(credentials: AuthCredentials): Promise<AccountProfile['connectedServicesV2']> {
  const response = await serverFetch('/v1/account/profile', {
    headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
  }, { includeAuth: false, retry: 'none' });
  if (!response.ok) throw new Error(`Failed to read connected accounts (${response.status})`);
  const parsed = AccountProfileSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error('Failed to read connected accounts (unreadable response)');
  return parsed.data.connectedServicesV2;
}

async function fetchConnectedServiceProfiles(
  credentials: AuthCredentials,
  serviceId: ConnectedServiceId,
): Promise<ReadonlyArray<Readonly<{ profileId: string; providerAccountId: string | null }>>> {
  const inventory = await fetchConnectedServicesInventory(credentials);
  return inventory.find((service) => service.serviceId === serviceId)?.profiles ?? [];
}

export async function storeConnectedServiceCredentialForAccount(
  credentials: AuthCredentials,
  params: Readonly<{
    serviceId: ConnectedServiceId;
    profileId: string;
    record: ConnectedServiceCredentialRecordV1;
  }>,
  opts?: Readonly<{
    allowProviderIdentityChange?: boolean;
    randomBytes?: (length: number) => Uint8Array;
    expectedCredentialRevision?: CredentialRevisionGuard;
  }>,
): Promise<ConnectedServiceCredentialRevisionBoundaryV1> {
  assertConnectedServiceCredentialRecordBinding({
    binding: { serviceId: params.serviceId, profileId: params.profileId },
    record: params.record,
  });
  const conflict = await findConnectedServiceEnrollmentConflict({
    record: params.record,
    readProfiles: () => fetchConnectedServiceProfiles(credentials, params.serviceId),
  });
  if (conflict?.kind === 'duplicate') {
    throw new HappyError(`This account is already connected as "${conflict.existingProfileId}"; re-authorize that profile instead.`, false);
  }
  if (conflict?.kind === 'unidentified') {
    throw new HappyError('The provider did not say which account this login belongs to, so it cannot be checked against the accounts already connected. Authorize again.', false);
  }
  const mode = await fetchAccountEncryptionMode(credentials, { retry: 'none' });
  const reconnect = opts?.allowProviderIdentityChange
    ? { allowProviderIdentityChange: true }
    : undefined;
  const intendedRecord = ConnectedServiceCredentialRecordV1Schema.parse(params.record);

  if (mode.mode === 'plain') {
    const explicitRevisionGuard = opts && 'expectedCredentialRevision' in opts;
    const initial = explicitRevisionGuard
      ? null
      : await readCurrentOrAbsent(() => getConnectedServiceCredentialPlain(credentials, params));
    // A successful credential read owns its revision semantics. Only a missing-create
    // needs server-contract selection, and that decision must be revalidated against
    // the server receiving the write so an in-place upgrade/rollback cannot reuse the
    // ten-minute ready-feature cache from the predecessor process.
    const serverCompatibilitySnapshot = !explicitRevisionGuard && initial === null
      ? await getServerFeaturesSnapshot({ force: true })
      : null;
    const expectedCredentialRevision = opts && 'expectedCredentialRevision' in opts
      ? opts.expectedCredentialRevision ?? null
      : initial?.credentialRevision ?? null;
    const selectedReleasedServerV021Contract = serverCompatibilitySnapshot !== null
      && isReleasedServerV021CompatibilitySnapshot(serverCompatibilitySnapshot);
    const revisionSemantics = opts && 'expectedCredentialRevision' in opts
      ? 'revisioned' as const
      : initial?.revisionSemantics
        ?? (selectedReleasedServerV021Contract ? 'legacy_unfenced' : 'revisioned');
    try {
      const stored = await writeWithAmbiguousSettlement({
        expectedCredentialRevision,
        write: () => registerConnectedServiceCredentialPlain(credentials, {
          serviceId: params.serviceId,
          profileId: params.profileId,
          record: intendedRecord,
          ...(revisionSemantics === 'revisioned'
            ? { revisionSemantics, expectedCredentialRevision }
            : { revisionSemantics }),
          ...(reconnect ? { reconnect } : {}),
        }),
        readCurrent: async () => {
          const current = await readCurrentOrAbsent(() => getConnectedServiceCredentialPlain(credentials, params));
          return current
            ? { ...credentialRevisionBoundary(current), content: current.content.v }
            : null;
        },
        isIntendedContent: (content) => JSON.stringify(content) === JSON.stringify(intendedRecord),
      });
      invalidateConnectedServiceQuotaSnapshotForCredential(credentials, intendedRecord);
      return stored;
    } catch (error) {
      if (isConnectedServiceApiErrorCode(error, PROVIDER_IDENTITY_MISMATCH_ERROR)) {
        throw new ConnectedServiceCredentialIdentityMismatchError(expectedCredentialRevision, error);
      }
      throw error;
    }
  }

  const ciphertext = sealConnectedServiceCredential({ credentials, record: params.record, randomBytes: opts?.randomBytes });
  const metadata = buildConnectedServiceCredentialMetadata(params.record);
  const initial = opts && 'expectedCredentialRevision' in opts
    ? null
    : await readCurrentOrAbsent(() => getConnectedServiceCredentialSealed(credentials, params));
  const expectedCredentialRevision = opts && 'expectedCredentialRevision' in opts
    ? opts.expectedCredentialRevision ?? null
    : initial?.credentialRevision ?? null;
  try {
    const stored = await writeWithAmbiguousSettlement({
      expectedCredentialRevision,
      write: () => registerConnectedServiceCredentialSealed(credentials, {
        serviceId: params.serviceId,
        profileId: params.profileId,
        sealed: { format: 'account_scoped_v1', ciphertext },
        metadata,
        expectedCredentialRevision,
        ...(reconnect ? { reconnect } : {}),
      }),
      readCurrent: async () => {
        const current = await readCurrentOrAbsent(() => getConnectedServiceCredentialSealed(credentials, params));
        return current
          ? { ...credentialRevisionBoundary(current), content: current }
          : null;
      },
      isIntendedContent: (content) => (
        content.sealed.format === 'account_scoped_v1'
        && content.sealed.ciphertext === ciphertext
        && content.metadata.kind === metadata.kind
        && (content.metadata.providerEmail ?? null) === metadata.providerEmail
        && (content.metadata.providerAccountId ?? null) === metadata.providerAccountId
        && (content.metadata.expiresAt ?? null) === metadata.expiresAt
        && (content.metadata.providerOrganizationId === undefined
          || content.metadata.providerOrganizationId === metadata.providerOrganizationId)
      ),
    });
    invalidateConnectedServiceQuotaSnapshotForCredential(credentials, intendedRecord);
    return stored;
  } catch (error) {
    if (isConnectedServiceApiErrorCode(error, PROVIDER_IDENTITY_MISMATCH_ERROR)) {
      throw new ConnectedServiceCredentialIdentityMismatchError(expectedCredentialRevision, error);
    }
    throw error;
  }
}

/**
 * A subscription login's refresh token lives with the account's managing machine, so only that
 * machine can say whether a terminal or a refresh is using it. The setting is read from the server for
 * this decision (a cached copy may predate another client's change); without a managing machine nothing
 * can confirm the login is unused, so the delete waits until one is chosen.
 */
async function assertSubscriptionLoginDeletable(
  serviceId: ConnectedServiceId,
  profileId: string,
): Promise<void> {
  if (!isConnectedServiceSubscriptionLogin(serviceId)) return;
  let stored: unknown;
  try {
    await getSyncSingleton().updateAccountSettingOnce({
      key: 'connectedServicesManagementV1',
      decide: (current) => {
        stored = current;
        return undefined;
      },
    });
  } catch {
    throw new HappyError(t('connectedServices.management.refused.unconfirmed'), true);
  }
  const management = ConnectedServicesManagementV1Schema.safeParse(stored ?? DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1);
  const machineId = management.success ? management.data.managingMachineId : null;
  if (!machineId) throw new HappyError(t('connectedServices.management.deleteBlocked.noManagingMachine'), false);
  const use = await connectedServiceLoginUse({ machineId, serviceId, profileId });
  if (use?.status === 'free') return;
  if (use?.status === 'in_use') {
    const reasonKey = {
      terminal: 'connectedServices.management.deleteBlocked.terminal',
      refreshing: 'connectedServices.management.deleteBlocked.refreshing',
      rotation_not_read_back: 'connectedServices.management.deleteBlocked.rotationNotReadBack',
    } as const;
    throw new HappyError(t(reasonKey[use.reason]), use.reason === 'refreshing');
  }
  throw new HappyError(t('connectedServices.management.deleteBlocked.machineUnconfirmed'), true);
}

export async function deleteConnectedServiceCredentialForAccount(
  credentials: AuthCredentials,
  params: Readonly<{
    serviceId: ConnectedServiceId;
    profileId: string;
    expectedCredentialRevision: ConnectedServiceCredentialRevisionV1 | null | undefined;
    cleanupGroupReferences?: boolean;
  }>,
): Promise<void> {
  await assertSubscriptionLoginDeletable(params.serviceId, params.profileId);
  const features = getCachedReadyServerFeatures() ?? await getReadyServerFeatures();
  const expectedCredentialRevision = params.expectedCredentialRevision;
  if (
    features?.capabilities.connectedServices.credentialDelete.revisionGuard !== true
    || !expectedCredentialRevision
  ) {
    throw new Error('Server update required to disconnect safely.');
  }
  const guardedParams = { ...params, expectedCredentialRevision };
  const mode = await fetchAccountEncryptionMode(credentials, { retry: 'none' });
  if (mode.mode === 'plain') {
    await deleteConnectedServiceCredentialV3(credentials, guardedParams);
    return;
  }
  await deleteConnectedServiceCredentialV2(credentials, guardedParams);
}
