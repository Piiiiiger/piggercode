import React from 'react';
import { useRouter } from 'expo-router';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ProviderSetupFlow } from '@/components/settings/providers/setup/ProviderSetupFlow';
import { AGENT_IDS, getAgentCore } from '@/agents/catalog/catalog';
import { isAgentEnabled, isAgentOffered } from '@/agents/catalog/enabled';
import { useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

export default React.memo(function ProviderSettingsIndexScreen() {
    const router = useRouter();
    const backendEnabledByTargetKey = useSetting('backendEnabledByTargetKey');
    // Only the agents this build offers.
    const providerIds = React.useMemo(
        () => AGENT_IDS.filter((agentId) => isAgentOffered(agentId)),
        [],
    );

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('settingsProviders.title')}
                footer={t('settingsProviders.footer')}
            >
                {providerIds.map((agentId) => {
                    const core = getAgentCore(agentId);
                    const isEnabled = isAgentEnabled({ agentId, backendEnabledByTargetKey });
                    const state = isEnabled ? t('settingsProviders.stateEnabled') : t('settingsProviders.stateDisabled');
                    const channel = core.availability.experimental ? t('settingsProviders.channelExperimental') : t('settingsProviders.channelStable');
                    return (
                        <Item
                            key={agentId}
                            title={t(core.displayNameKey)}
                            subtitle={`${state} • ${channel}`}
                            icon={<AgentIcon agentId={agentId} size={29} />}
                            onPress={() => router.push(`/settings/providers/${agentId}` as any)}
                        />
                    );
                })}
            </ItemGroup>
            <ProviderSetupFlow providerIds={providerIds} />
        </ItemList>
    );
});
