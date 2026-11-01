import * as React from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import { useLocalSettingMutable, type SessionListViewItem } from '@/sync/domains/state/storage';
import { countSessionListSessionsByAgent } from '@/sync/domains/session/listing/sessionListAgentFilter';

import { SessionListAgentTabs } from './pathTree/SessionListAgentTabs';

const stylesheet = StyleSheet.create(() => ({
    browseActionContainer: {
        marginTop: -4,
    },
    browseActionGroupSurface: {
        backgroundColor: 'transparent',
        boxShadow: 'none',
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
}));

export type SessionsListStorageChromeProps = Readonly<{
    directSessionsEnabled: boolean;
    /** The list's sessions, for the agent tabs; null while the list loads. */
    data?: ReadonlyArray<SessionListViewItem> | null;
}>;

/**
 * The bar above the session list: tabs that switch it between all sessions and one agent's (CLI's),
 * with the entry for opening provider sessions that are not in the list yet. Before there are any
 * sessions, that entry is a full row so a new list still points somewhere useful.
 */
export const SessionsListStorageChrome = React.memo((props: SessionsListStorageChromeProps) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [selectedAgentId, setSelectedAgentId] = useLocalSettingMutable('sessionListAgentFilterV1');
    const counts = React.useMemo(() => countSessionListSessionsByAgent(props.data ?? []), [props.data]);
    const openBrowse = React.useCallback(() => {
        router.push('/direct/browse');
    }, [router]);

    if (counts.size > 0) {
        return (
            <SessionListAgentTabs
                counts={counts}
                selectedAgentId={selectedAgentId ?? null}
                onSelectAgent={setSelectedAgentId}
                onBrowse={props.directSessionsEnabled ? openBrowse : null}
            />
        );
    }

    if (!props.directSessionsEnabled) return null;

    return (
        <ItemGroup
            style={styles.browseActionContainer}
            containerStyle={styles.browseActionGroupSurface}
            constrainToContentWidth={false}
        >
            <Item
                testID="direct-sessions-browse-button"
                title={t('directSessions.browseOpenExisting')}
                subtitle={t('directSessions.browseActionSubtitle')}
                icon={<Icon name="folder-open" size={20} color={theme.colors.text.secondary} />}
                onPress={openBrowse}
            />
        </ItemGroup>
    );
});
