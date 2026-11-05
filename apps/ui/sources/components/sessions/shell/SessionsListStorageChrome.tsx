import * as React from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import {
    useLocalSettingMutable,
    useSessionExplorerMachines,
    useSetting,
    type SessionListViewItem,
} from '@/sync/domains/state/storage';
import {
    countSessionListSessionsByAgent,
    listSessionListAgentOptions,
    resolveSessionListAgentSelection,
} from '@/sync/domains/session/listing/sessionListAgentFilter';

import { SessionListAgentPicker } from './explorer/SessionListAgentPicker';
import { SessionExplorerModeSwitch } from './explorer/SessionExplorerModeSwitch';
import { useInstalledAgentClis } from './explorer/useInstalledAgentClis';

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

const EMPTY_ITEMS: ReadonlyArray<SessionListViewItem> = Object.freeze([]);

export type SessionsListStorageChromeProps = Readonly<{
    directSessionsEnabled: boolean;
    /** The list's sessions, for the agent picker; null while the list loads. */
    data?: ReadonlyArray<SessionListViewItem> | null;
}>;

/**
 * The bar above the session list: a select box for the agent (CLI) whose sessions the list shows,
 * with the entry for opening provider sessions that are not in the list yet. With no agent to offer
 * (no sessions and no machine online), that entry is a full row so a new list still points somewhere useful.
 */
export const SessionsListStorageChrome = React.memo((props: SessionsListStorageChromeProps) => {
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const items = props.data ?? EMPTY_ITEMS;
    const [picked, setPicked] = useLocalSettingMutable('sessionListAgentFilterV1');
    const explorerMachines = useSessionExplorerMachines();
    // Only machines that run agents are probed for them or browsed for their provider history.
    const machines = React.useMemo(() => explorerMachines.filter((machine) => machine.agentsHosted), [explorerMachines]);
    // The machines are the active server's, which is also where a null server id points the capability cache.
    const { installed, detect } = useInstalledAgentClis({ serverId: null, machines });
    const counts = React.useMemo(() => countSessionListSessionsByAgent(items), [items]);
    const selected = React.useMemo(() => resolveSessionListAgentSelection(picked, items), [items, picked]);
    const options = React.useMemo(
        () => listSessionListAgentOptions({ counts, installed, selected }),
        [counts, installed, selected],
    );
    const anyMachineOnline = machines.some((machine) => machine.online);
    const openBrowse = React.useCallback(() => {
        router.push('/direct/browse');
    }, [router]);
    // The explorer switches between its Sessions and Files views; the Files view needs no agent picker.
    const explorerLayout = useSetting('sessionListLayoutV1') !== 'list';
    const [explorerModeSetting, setExplorerMode] = useLocalSettingMutable('sessionListExplorerModeV1');
    const filesView = explorerLayout && explorerModeSetting === 'files';
    const modeSwitch = explorerLayout
        ? <SessionExplorerModeSwitch mode={filesView ? 'files' : 'sessions'} onChange={setExplorerMode} />
        : null;

    if (filesView) return modeSwitch;

    if (options.length > 0 || anyMachineOnline) {
        return (
            <>
                {modeSwitch}
                <SessionListAgentPicker
                    options={options}
                    selected={selected}
                    counts={counts}
                    onSelect={setPicked}
                    onOpen={detect}
                    onBrowse={props.directSessionsEnabled ? openBrowse : null}
                />
            </>
        );
    }

    if (!props.directSessionsEnabled) return modeSwitch;

    return (
        <>
        {modeSwitch}
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
        </>
    );
});
