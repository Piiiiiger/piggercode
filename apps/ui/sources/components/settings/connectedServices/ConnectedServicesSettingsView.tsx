import { ProviderUsageGaugeSettingsGroup } from './ProviderUsageGaugeSettingsGroup';
import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { useProfile, useSettingMutable, useSettings } from '@/sync/store/hooks';
import { useApplySettings } from '@/sync/store/settingsWriters';
import { Modal } from '@/modal';
import { CONNECTED_SERVICES_REGISTRY, getConnectedServiceRegistryEntry } from '@/sync/domains/connectedServices/connectedServiceRegistry';
import { AGENT_IDS, getAgentCore } from '@/agents/catalog/catalog';
import { isAgentOffered } from '@/agents/catalog/enabled';
import {
    ConnectedServicesProviderStateSharingSettingsV1Schema,
    buildConnectedServicesDefaultAuthSettingsPatch,
    type ConnectedServicesDefaultAuthByAgentIdV1,
    type ConnectedServiceId,
} from '@piggercode/protocol';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useServerFeaturesRuntimeSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { supportsConnectedServiceOperation } from '@piggercode/protocol';
import {
  readConnectedServiceProfileKindFromServices,
  resolveConnectedServiceProfileActionRoute,
} from '@/sync/domains/connectedServices/resolveConnectedServiceProfileActionRoute';
import { resolveConnectedServiceDisplayName } from './model/resolveConnectedServiceDisplayName';
import { AccountsOverview } from './overview/AccountsOverview';
import { ConnectedServicesDefaultAuthRow } from './ConnectedServicesDefaultAuthRow';
import { ConnectedServicesProviderStateSharingDefaultsGroup } from './ConnectedServicesProviderStateSharingSettings';
import { ConnectedServicesManagementGroup } from './management/ConnectedServicesManagementGroup';
import { SettingsHeaderAddButton } from '../navigation/SettingsHeaderAddButton';

export const ConnectedServicesSettingsView = React.memo(function ConnectedServicesSettingsView() {
  const { theme } = useUnistyles();
  const profile = useProfile();
  const settings = useSettings();
  const [providerStateSharingSettings, setProviderStateSharingSettings] =
    useSettingMutable('connectedServicesProviderStateSharingSettingsV1');
  const applySettings = useApplySettings();
  const setDefaultAuthSettings = React.useCallback((next: ConnectedServicesDefaultAuthByAgentIdV1) => {
    applySettings(buildConnectedServicesDefaultAuthSettingsPatch(next));
  }, [applySettings]);
  const [poolAdoptionDismissedByKey, setPoolAdoptionDismissedByKey] =
    useSettingMutable('connectedServicesDefaultAuthPoolAdoptionDismissedByKey');
  const dismissPoolAdoptionSuggestion = React.useCallback((key: string) => {
    setPoolAdoptionDismissedByKey({
      ...(poolAdoptionDismissedByKey ?? {}),
      [key]: true,
    });
  }, [poolAdoptionDismissedByKey, setPoolAdoptionDismissedByKey]);
  const router = useRouter();
  const navigation = useNavigation();
  const connectedServicesEnabled = useFeatureEnabled('connectedServices');
  const accountGroupsEnabled = useFeatureEnabled('connectedServices.accountGroups');
  const quotasEnabled = useFeatureEnabled('connectedServices.quotas');
  const subscriptionEnabled = useFeatureEnabled('connectedServices.subscription');
  const usageEnabled = quotasEnabled || subscriptionEnabled;
  const serverFeatures = useServerFeaturesRuntimeSnapshot({ enabled: connectedServicesEnabled });
  const readyFeatures = serverFeatures.status === 'ready' ? serverFeatures.features : null;
  const normalizedProviderStateSharingSettings = React.useMemo(
    () => ConnectedServicesProviderStateSharingSettingsV1Schema.parse(providerStateSharingSettings),
    [providerStateSharingSettings],
  );
  const services = React.useMemo(() => profile.connectedServicesV2.filter(
    (service) => supportsConnectedServiceOperation(readyFeatures, service.serviceId),
  ), [profile.connectedServicesV2, readyFeatures]);
  const allServiceIds = React.useMemo(() => Array.from(new Set<ConnectedServiceId>([
    ...CONNECTED_SERVICES_REGISTRY.map((entry) => entry.serviceId),
    ...services.map((service) => service.serviceId),
  ])).filter((serviceId) => supportsConnectedServiceOperation(readyFeatures, serviceId)), [readyFeatures, services]);

  const openServiceDetail = React.useCallback((serviceId: ConnectedServiceId, label: string, connectCommand: string) => {
    if (!supportsConnectedServiceOperation(readyFeatures, serviceId)) return;
    try {
      router.push({ pathname: '/settings/connected-services/[serviceId]', params: { serviceId } });
    } catch {
      // Fallback for environments without route support.
      void Modal.alert(
        t('connect.unsupported.connectTitle', { name: label }),
        t('connect.unsupported.runCommandInTerminal'),
        [{ text: connectCommand, style: 'default' }, { text: t('common.ok'), style: 'cancel' }],
      );
    }
  }, [readyFeatures, router]);

  // One row per service that can take an account: the way in to sign in or manage it.
  const serviceRows = React.useMemo(() => allServiceIds.map((serviceId) => ({
    serviceId,
    entry: getConnectedServiceRegistryEntry(serviceId),
    label: resolveConnectedServiceDisplayName(serviceId, t),
    accountCount: services.find((service) => service.serviceId === serviceId)?.profiles.length ?? 0,
  })), [allServiceIds, services]);

  const openService = React.useCallback((serviceId: ConnectedServiceId) => {
    const row = serviceRows.find((candidate) => candidate.serviceId === serviceId);
    if (row) openServiceDetail(row.serviceId, row.label, row.entry.connectCommand);
  }, [openServiceDetail, serviceRows]);

  // Header-right "+": start the connect/add flow by picking a provider to open
  // (the per-provider add-account flow lives on the [serviceId] detail screen).
  const handleHeaderAdd = React.useCallback(() => {
    const rows = serviceRows;
    if (rows.length === 0) return;
    if (rows.length === 1) {
      openServiceDetail(rows[0].serviceId, rows[0].label, rows[0].entry.connectCommand);
      return;
    }
    void Modal.alert(
      t('connectedServices.list.addServiceTitle'),
      t('connectedServices.list.addServiceMessage'),
      [
        ...rows.map((row) => ({
          text: row.label,
          style: 'default' as const,
          onPress: () => openServiceDetail(row.serviceId, row.label, row.entry.connectCommand),
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ],
    );
  }, [serviceRows, openServiceDetail]);

  const canAddService = connectedServicesEnabled && serviceRows.length > 0;

  React.useLayoutEffect(() => {
    // `useNavigation` returns null when the view is rendered outside a navigator
    // (e.g. embedded previews / tests). Guard so the header wiring is opt-in.
    if (!navigation) return;
    navigation.setOptions({
      // The page carries its own large title; without the page, the header names it.
      headerTitle: connectedServicesEnabled ? '' : t('settings.connectedServices'),
      headerRight: canAddService
        ? () => (
          <SettingsHeaderAddButton
            testID="connected-services-index:header-add"
            accessibilityLabel={t('connectedServices.list.addServiceTitle')}
            onPress={handleHeaderAdd}
          />
        )
        : undefined,
    });
  }, [canAddService, connectedServicesEnabled, handleHeaderAdd, navigation]);

  if (!connectedServicesEnabled) {
    return (
      <ItemList>
        <ItemGroup title={t('connectedServices.title')}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: theme.colors.text.secondary }}>
              {t('settings.connectedAccountsDisabled')}
            </Text>
          </View>
        </ItemGroup>
      </ItemList>
    );
  }

  return (
    <ItemList>
      <AccountsOverview
        services={services}
        labelsByKey={settings.connectedServicesProfileLabelByKey}
        usageEnabled={usageEnabled}
        addRows={serviceRows}
        onOpenService={openService}
      />
      <ItemGroup
        title={t('connectedServices.defaultAuth.title')}
        footer={t('connectedServices.defaultAuth.footer')}
      >
        {AGENT_IDS.filter(isAgentOffered).map((agentId) => {
          const agentCore = getAgentCore(agentId);
          if ((agentCore.connectedServices?.supportedServiceIds ?? []).length === 0) return null;
          return (
            <ConnectedServicesDefaultAuthRow
              key={agentId}
              agentId={agentId}
              agentTitle={t(agentCore.displayNameKey)}
              agentCore={agentCore}
              connectedServicesEnabled={connectedServicesEnabled}
              accountGroupsEnabled={accountGroupsEnabled}
              accountProfileConnectedServicesV2={services}
              settings={{
                connectedServicesProfileLabelByKey: settings.connectedServicesProfileLabelByKey,
                connectedServicesDefaultProfileByServiceId: settings.connectedServicesDefaultProfileByServiceId,
                connectedServicesDefaultAuthByAgentIdV1: settings.connectedServicesDefaultAuthByAgentIdV1,
                connectedServicesAdditionalDefaultAuthByAgentIdV1: settings.connectedServicesAdditionalDefaultAuthByAgentIdV1,
              }}
              setDefaultAuthSettings={setDefaultAuthSettings}
              onOpenConnectedServiceSettings={(serviceId) => router.push({
                pathname: '/settings/connected-services/[serviceId]',
                params: { serviceId },
              })}
              onReconnectConnectedServiceProfile={(serviceId, profileId) => router.push(
                resolveConnectedServiceProfileActionRoute({
                  serviceId,
                  profileId,
                  profileKind: readConnectedServiceProfileKindFromServices({
                    connectedServicesV2: services,
                    serviceId,
                    profileId,
                  }),
                }),
              )}
              dismissedPoolAdoptionSuggestionKeys={poolAdoptionDismissedByKey}
              onDismissPoolAdoptionSuggestion={dismissPoolAdoptionSuggestion}
            />
          );
        })}
      </ItemGroup>
      <ProviderUsageGaugeSettingsGroup />
      <ConnectedServicesManagementGroup />
      <ConnectedServicesProviderStateSharingDefaultsGroup
        settings={normalizedProviderStateSharingSettings}
        setSettings={setProviderStateSharingSettings}
        onOpenBackendOverrides={() => router.push('/settings/connected-services/provider-state-sharing')}
      />
    </ItemList>
  );
});
