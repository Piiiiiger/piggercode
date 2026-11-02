import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SegmentedTabBar, type SegmentedTab } from '@/components/ui/navigation/SegmentedTabBar';
import type { SessionExplorerMode } from '@/sync/domains/session/listing/sessionListExplorer';
import { t } from '@/text';

const stylesheet = StyleSheet.create(() => ({
    container: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 4,
    },
}));

export type SessionExplorerModeSwitchProps = Readonly<{
    mode: SessionExplorerMode;
    onChange: (mode: SessionExplorerMode) => void;
}>;

/** Switches the explorer between its two views: folders with their sessions, and folders with their files. */
export const SessionExplorerModeSwitch = React.memo(function SessionExplorerModeSwitch(props: SessionExplorerModeSwitchProps) {
    const tabs = React.useMemo((): ReadonlyArray<SegmentedTab<SessionExplorerMode>> => [
        { id: 'sessions', label: t('sessionsList.explorerModeSessions') },
        { id: 'files', label: t('sessionsList.explorerModeFiles') },
    ], []);
    return (
        <View style={stylesheet.container}>
            <SegmentedTabBar
                tabs={tabs}
                activeTabId={props.mode}
                onSelectTab={props.onChange}
                compact
                testIDPrefix="session-explorer-mode"
            />
        </View>
    );
});
