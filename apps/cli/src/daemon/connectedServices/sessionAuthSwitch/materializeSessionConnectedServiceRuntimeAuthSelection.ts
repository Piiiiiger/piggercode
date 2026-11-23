import type { ApiClient } from '@/api/api';
import { materializeConnectedServiceRuntimeAuthSelectionThroughCatalog } from '@/backends/catalog';
import { resolveConnectedServiceCredentialsWithRevisions } from '@/cloud/connectedServices/resolveConnectedServiceCredentials';
import type { Credentials } from '@/persistence';
import { findConnectedServiceChildSelection } from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import {
  ConnectedServiceCredentialRevisionV1Schema,
  isConnectedServiceSubscriptionLogin,
  type AccountSettings,
  type ConnectedServiceId,
} from '@piggercode/protocol';

import {
  ConnectedServiceManagementDeniedError,
  connectedServiceManagementDeniedError,
  type ConnectedServiceManagement,
} from '../management/connectedServiceManagement';
import {
  assertNoSharedPoolHomeForSelfRotatingLogins,
  assertSubscriptionLoginOriginsVerified,
} from '../resolveConnectedServiceAuthForSpawn';
import { createConnectedServiceAuthGenerationApplyFailureError } from '../runtimeAuth/connectedServiceAuthGenerationApplyFailure';
import type { SessionConnectedServiceRuntimeAuthSelectionMaterializerInput } from './switchSessionConnectedServiceAuth';

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function materializeSessionConnectedServiceRuntimeAuthSelection(params: Readonly<{
  credentials: Credentials;
  api: ApiClient;
  activeServerDir?: string;
  input: SessionConnectedServiceRuntimeAuthSelectionMaterializerInput;
  accountSettings?: AccountSettings | null;
  processEnv?: NodeJS.ProcessEnv;
  /** Single-machine management: preparing a switch is a managed entry like a launch (I2). */
  management: ConnectedServiceManagement;
  /** The refresh owner's launch hold: no rotation of the target login while its home is prepared. */
  holdNativeCredentialLaunch: (
    binding: Readonly<{ serviceId: ConnectedServiceId; profileId: string }>,
  ) => Promise<(() => void) | null>;
}>): Promise<unknown | null> {
  if (params.input.next.source !== 'connected') return null;
  const binding = params.input.normalizedBindings.bindingsByServiceId[params.input.serviceId];
  if (!binding || binding.source !== 'connected') return null;

  const previousSelection = findConnectedServiceChildSelection(
    params.input.tracked?.spawnOptions?.environmentVariables ?? {},
    params.input.serviceId,
  );
  const previousGroupSelection =
    binding.selection === 'group'
    && previousSelection?.kind === 'group'
    && previousSelection.groupId === binding.groupId
      ? previousSelection
      : null;
  const groupMetadata =
    binding.selection === 'group'
    && params.input.groupMetadata?.groupId === binding.groupId
      ? params.input.groupMetadata
      : null;
  const profileId = binding.selection === 'group'
    ? readNonEmptyString(params.input.next.profileId)
      || readNonEmptyString(groupMetadata?.activeProfileId)
      || readNonEmptyString(previousGroupSelection?.activeProfileId)
      || readNonEmptyString(binding.profileId)
    : readNonEmptyString(binding.profileId);
  if (!profileId) return null;

  const serviceId = params.input.serviceId;
  const subscriptionLogin = isConnectedServiceSubscriptionLogin(serviceId);
  if (subscriptionLogin) {
    // Renewing the login the session already runs on, through the same binding, is refresh work (pools
    // being paused does not stop it); any other target puts a login into a session, like a launch.
    const renewal = binding.selection === 'group'
      ? previousSelection?.kind === 'group' && previousSelection.groupId === binding.groupId
        && previousSelection.activeProfileId === profileId
      : previousSelection?.kind === 'profile' && previousSelection.profileId === profileId;
    const decision = renewal
      ? params.management.decide(serviceId, 'refresh')
      : await params.management.decideLaunch(serviceId);
    if (!decision.allowed) throw connectedServiceManagementDeniedError(serviceId, decision);
    if (binding.selection === 'group') await assertNoSharedPoolHomeForSelfRotatingLogins(new Map([[serviceId, binding]]));
  }
  // A rotation of the target login in flight finishes first, and none starts while its home is written.
  const releaseHold = await params.holdNativeCredentialLaunch({ serviceId, profileId });
  try {
    const credentialsByServiceId = await resolveConnectedServiceCredentialsWithRevisions({
      credentials: params.credentials,
      api: params.api,
      bindings: [{ serviceId, profileId }],
    });
    const resolvedCredential = credentialsByServiceId.get(serviceId);
    if (!resolvedCredential) return null;
    if (subscriptionLogin) {
      // A client's rotation can only be read back by compare-and-set; and only PiggerCode's own grants are used.
      if (resolvedCredential.credentialRevision === null) {
        throw new ConnectedServiceManagementDeniedError({ serviceId, reason: 'relay_without_revisions', managingMachineId: null });
      }
      assertSubscriptionLoginOriginsVerified({
        recordsByServiceId: new Map([[serviceId, resolvedCredential.record]]),
        credentialBindings: [{ serviceId, profileId }],
      });
    }
    if (params.input.expectedCredentialRevision !== undefined) {
      const actualCredentialRevision = ConnectedServiceCredentialRevisionV1Schema.safeParse(
        resolvedCredential.credentialRevision,
      );
      if (!actualCredentialRevision.success) {
        throw createConnectedServiceAuthGenerationApplyFailureError({
          errorCode: 'credential_revision_missing',
        });
      }
      if (actualCredentialRevision.data !== params.input.expectedCredentialRevision) {
        throw createConnectedServiceAuthGenerationApplyFailureError({
          errorCode: 'credential_revision_superseded',
        });
      }
    }

    const baseSelection = {
      serviceId: params.input.serviceId,
      binding,
      profileId,
      credentialRevision: resolvedCredential.credentialRevision,
      ...(binding.selection === 'group'
        ? {
            groupId: binding.groupId,
            activeProfileId: profileId,
            fallbackProfileId: readNonEmptyString(groupMetadata?.fallbackProfileId)
              || readNonEmptyString(previousGroupSelection?.fallbackProfileId)
              || profileId,
            generation: typeof groupMetadata?.generation === 'number'
              ? groupMetadata.generation
              : typeof previousGroupSelection?.generation === 'number'
                ? previousGroupSelection.generation
                : 0,
          }
        : {}),
      record: resolvedCredential.record,
    };

    return await materializeConnectedServiceRuntimeAuthSelectionThroughCatalog(params.input.agentId, {
      ...params,
      baseSelection,
    }) ?? baseSelection;
  } finally {
    releaseHold?.();
  }
}
