import * as React from 'react';

import type { ConnectedServiceId } from '@piggercode/protocol';

import { useAuth } from '@/auth/context/AuthContext';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Modal } from '@/modal';
import { invalidateConnectedServiceGroupsRefreshSignal } from '@/sync/domains/connectedServices/connectedServiceGroupsRefreshSignal';
import {
  pruneConnectedServiceProfilePreferencesForDeletedProfile,
  resolveConnectedServiceProfileLabel,
} from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { deleteConnectedServiceCredentialForAccount } from '@/sync/domains/connectedServices/storeConnectedServiceCredentialForAccount';
import { useProfile, useSettings } from '@/sync/store/hooks';
import { useApplySettings } from '@/sync/store/settingsWriters';
import { sync } from '@/sync/sync';
import { t } from '@/text';

import {
  isConnectedServiceCredentialReferencedByGroupError,
  refreshConnectedServiceProfileAfterSupersededMutation,
  resolveConnectedServiceSettingsErrorMessage,
} from '../errors/connectedServiceSettingsErrors';
import { resolveConnectedServiceDisplayName } from '../model/resolveConnectedServiceDisplayName';
import { resolveConnectedServiceProfileIdentityDisplay } from '../model/resolveConnectedServiceIdentityDisplay';
import {
  formatConnectedServiceProfileGroupReferenceLabels,
  resolveConnectedServiceProfileGroupReferenceLabels,
} from '../model/resolveConnectedServiceProfileGroupReferences';

export type DisconnectConnectedServiceProfileTarget = Readonly<{
  serviceId: ConnectedServiceId;
  profileId: string;
  /** The pools that name this login; by default, those the account's projection lists. */
  groupReferenceLabels?: ReadonlyArray<string>;
}>;

/**
 * Removing one login, wherever it is offered: asks first (naming the pools it leaves), removes it from the
 * account, drops its name and default, and offers to take it out of its pools when the relay refuses because of
 * them. Resolves true once the login is gone.
 */
export function useDisconnectConnectedServiceProfile(): (target: DisconnectConnectedServiceProfileTarget) => Promise<boolean> {
  const auth = useAuth();
  const profile = useProfile();
  const settings = useSettings();
  const applySettings = useApplySettings();
  const accountGroupsEnabled = useFeatureEnabled('connectedServices.accountGroups');

  return React.useCallback(async (target) => {
    const { serviceId, profileId } = target;
    const service = profile.connectedServicesV2.find((candidate) => candidate.serviceId === serviceId) ?? null;
    const record = service?.profiles.find((candidate) => candidate.profileId === profileId) ?? null;
    const serviceLabel = resolveConnectedServiceDisplayName(serviceId, t);
    const profileLabel = resolveConnectedServiceProfileIdentityDisplay({
      profileId,
      label: resolveConnectedServiceProfileLabel({
        labelsByKey: settings.connectedServicesProfileLabelByKey,
        serviceId,
        profileId,
      }),
      providerEmail: typeof record?.providerEmail === 'string' ? record.providerEmail : '',
    }).diagnosticLabel;
    const groupReferenceLabels = target.groupReferenceLabels ?? (accountGroupsEnabled
      ? resolveConnectedServiceProfileGroupReferenceLabels({ profileId, projectedGroups: service?.groups })
      : []);
    const cleanupGroupReferences = groupReferenceLabels.length > 0;

    const ok = await Modal.confirm(
      t('modals.disconnect'),
      cleanupGroupReferences
        ? t('connectedServices.detail.disconnectGroupCleanupConfirmBody', {
          service: serviceLabel,
          profileId: profileLabel,
          groups: formatConnectedServiceProfileGroupReferenceLabels(groupReferenceLabels),
        })
        : t('connectedServices.detail.disconnectConfirmBody', { service: serviceLabel, profileId: profileLabel }),
      { confirmText: t('modals.disconnect'), cancelText: t('common.cancel') },
    );
    if (!ok) return false;

    const disconnect = async (cleanup: boolean) => {
      if (!auth.credentials) throw new Error('Not authenticated');
      const expectedCredentialRevision = profile.connectedServiceCredentialRevisionsV1.find((candidate) => (
        candidate.serviceId === serviceId && candidate.profileId === profileId
      ))?.credentialRevision;
      await deleteConnectedServiceCredentialForAccount(auth.credentials, {
        serviceId,
        profileId,
        expectedCredentialRevision,
        ...(cleanup ? { cleanupGroupReferences: true } : {}),
      });
      applySettings(pruneConnectedServiceProfilePreferencesForDeletedProfile({
        serviceId,
        profileId,
        connectedServicesDefaultProfileByServiceId: settings.connectedServicesDefaultProfileByServiceId,
        connectedServicesProfileLabelByKey: settings.connectedServicesProfileLabelByKey,
      }));
      await sync.refreshProfile();
      invalidateConnectedServiceGroupsRefreshSignal();
    };
    const reportFailure = async (error: unknown) => {
      await refreshConnectedServiceProfileAfterSupersededMutation(error, () => sync.refreshProfile());
      await Modal.alert(t('common.error'), resolveConnectedServiceSettingsErrorMessage(error));
    };

    try {
      await disconnect(cleanupGroupReferences);
      return true;
    } catch (error: unknown) {
      if (cleanupGroupReferences || !isConnectedServiceCredentialReferencedByGroupError(error)) {
        await reportFailure(error);
        return false;
      }
    }
    // The relay knows of pools this screen did not: offer to take the login out of them too.
    const retry = await Modal.confirm(
      t('connectedServices.detail.errors.disconnectGroupCleanupRetryTitle'),
      t('connectedServices.detail.errors.disconnectGroupCleanupRetryBody', { service: serviceLabel, profileId: profileLabel }),
      {
        confirmText: t('connectedServices.detail.errors.disconnectGroupCleanupRetryConfirm'),
        cancelText: t('common.cancel'),
      },
    );
    if (!retry) return false;
    try {
      await disconnect(true);
      return true;
    } catch (retryError: unknown) {
      await reportFailure(retryError);
      return false;
    }
  }, [
    accountGroupsEnabled,
    applySettings,
    auth.credentials,
    profile.connectedServiceCredentialRevisionsV1,
    profile.connectedServicesV2,
    settings.connectedServicesDefaultProfileByServiceId,
    settings.connectedServicesProfileLabelByKey,
  ]);
}
