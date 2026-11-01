import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AgentId } from '@happier-dev/agents';

import { AGENT_IDS, getAgentCore } from '@/agents/registry/registryCore';
import { Icon } from '@/components/ui/icons/Icon';
import { SegmentedTabBar, type SegmentedTab } from '@/components/ui/navigation/SegmentedTabBar';
import { t } from '@/text';

const ALL_TAB = 'all';

const stylesheet = StyleSheet.create(() => ({
    row: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 8,
    },
    tabs: {
        flex: 1,
        minWidth: 0,
    },
    browseButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
}));

export type SessionListAgentTabsProps = Readonly<{
    /** Sessions per agent; only agents with sessions get a tab. */
    counts: ReadonlyMap<AgentId, number>;
    /** The remembered agent; null (or an agent without sessions) shows all. */
    selectedAgentId: string | null;
    onSelectAgent: (agentId: AgentId | null) => void;
    /** Opens the provider sessions browser; omitted when direct sessions are off. */
    onBrowse: (() => void) | null;
}>;

/** Switches the session list between all sessions and one agent's (CLI's) sessions. */
export const SessionListAgentTabs = React.memo(function SessionListAgentTabs(props: SessionListAgentTabsProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const tabs = React.useMemo<ReadonlyArray<SegmentedTab<string>>>(() => {
        let total = 0;
        for (const count of props.counts.values()) total += Math.max(0, count);
        const agentTabs: SegmentedTab<string>[] = [];
        // Catalog order keeps each tab in place as counts change.
        for (const agentId of AGENT_IDS) {
            const count = props.counts.get(agentId) ?? 0;
            if (count <= 0) continue;
            const name = t(getAgentCore(agentId).displayNameKey);
            agentTabs.push({
                id: agentId,
                label: t('sessionsList.agentTabLabel', { name, count }),
                accessibilityLabel: t('sessionsList.agentTabA11y', { name, count }),
            });
        }
        const allName = t('sessionsList.agentTabAll');
        return [
            {
                id: ALL_TAB,
                label: t('sessionsList.agentTabLabel', { name: allName, count: total }),
                accessibilityLabel: t('sessionsList.agentTabA11y', { name: allName, count: total }),
            },
            ...agentTabs,
        ];
    }, [props.counts]);

    const selected = props.selectedAgentId && (props.counts.get(props.selectedAgentId as AgentId) ?? 0) > 0
        ? props.selectedAgentId
        : ALL_TAB;
    const { onSelectAgent } = props;
    const handleSelectTab = React.useCallback((tabId: string) => {
        onSelectAgent(tabId === ALL_TAB ? null : tabId as AgentId);
    }, [onSelectAgent]);

    return (
        <View style={styles.row}>
            <View style={styles.tabs}>
                <SegmentedTabBar
                    tabs={tabs}
                    activeTabId={selected}
                    onSelectTab={handleSelectTab}
                    testIDPrefix="session-list-agent-tabs"
                    compact
                />
            </View>
            {props.onBrowse ? (
                <Pressable
                    testID="session-list-browse-provider-sessions"
                    onPress={props.onBrowse}
                    style={styles.browseButton}
                    accessibilityRole="button"
                    accessibilityLabel={t('directSessions.browseOpenExisting')}
                    hitSlop={4}
                >
                    <Icon name="folder-open" size={18} color={theme.colors.text.secondary} />
                </Pressable>
            ) : null}
        </View>
    );
});
