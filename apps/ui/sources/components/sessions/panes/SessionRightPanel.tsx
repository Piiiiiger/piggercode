import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { IconAction } from '@/components/ui/buttons/IconAction';
import { SegmentedTabBar, SEGMENTED_TAB_ICON_SIZE_PX, type SegmentedTab } from '@/components/ui/navigation/SegmentedTabBar';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { SessionBrowseFilesSurface } from '@/components/sessions/panes/surfaces/SessionBrowseFilesSurface';
import { SessionGitSurface } from '@/components/sessions/panes/surfaces/SessionGitSurface';
import { SessionTerminalSurface } from '@/components/sessions/panes/surfaces/SessionTerminalSurface';
import { useSessionFileDetailsOpener } from '@/components/sessions/panes/useSessionFileDetailsOpener';
import { useSessionTerminalAvailability } from '@/components/sessions/terminal/useSessionTerminalAvailability';
import { t } from '@/text';
import { resolveOptionalSessionScreenTestId, useSessionScreenTestIdsEnabled } from '../shell/sessionScreenTestIds';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveSessionHeaderActionTargetPx } from '@/components/sessions/actions/sessionHeaderIconMetrics';

import { usePaneActionRail } from '@/components/appShell/panes/PaneActionRailContext';
import { getSessionRightPanelTabs, type SessionRightTabId as RightTabId } from './sessionRightPanelTabs';

export type SessionRightPanelProps = Readonly<{
    sessionId: string;
    scopeId: string;
    serverId?: string | null;
    presentation?: 'pane' | 'screen';
    /**
     * Optional override for the close action. Used by fullscreen/mobile routes that render the
     * same surface as the desktop right pane but need to navigate back in the router stack.
     */
    onRequestClose?: () => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
        minHeight: 0,
        minWidth: 0,
        // No top border. The dock already separates this pane from the main content with its own
        // seam, so this line only ran along the window's top edge and doubled the chrome.
    },
    header: {
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 8,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    segmentedContainer: {
        flex: 1,
    },
    body: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
}));

export const SessionRightPanel = React.memo((props: SessionRightPanelProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const pane = useAppPaneScope(props.scopeId);
    const scopeState = pane.scopeState;
    const { openFileInDetails, openFileInDetailsPinned } = useSessionFileDetailsOpener(props.scopeId);

    const terminalAvailability = useSessionTerminalAvailability({
        sessionId: props.sessionId,
        serverId: props.serverId ?? null,
    });
    const sessionScreenTestIdsEnabled = useSessionScreenTestIdsEnabled();
    const externalRail = usePaneActionRail();
    const hideHeader = externalRail && props.presentation !== 'screen';
    const terminalTabAvailable = terminalAvailability.sidebarTabAvailable;
    const closeButtonAtStart = props.presentation === 'screen' && Platform.OS !== 'web';
    const savedTab = scopeState?.right.activeTabId ?? null;
    // A tab the panel no longer offers (a terminal on a machine without one, or an older saved
    // transcript-navigation or agents tab) opens git instead.
    const activeTab: RightTabId = savedTab === 'files' || (savedTab === 'terminal' && terminalTabAvailable)
        ? savedTab
        : 'git';

    const setActiveTab = React.useCallback((tabId: RightTabId) => {
        pane.openRight({ tabId });
        pane.setRightTab(tabId);
    }, [pane]);

    React.useEffect(() => {
        if (!scopeState?.right.isOpen) return;
        if (scopeState.right.activeTabId !== activeTab) {
            pane.setRightTab(activeTab);
        }
    }, [activeTab, pane, scopeState?.right.activeTabId, scopeState?.right.isOpen]);

    const closeButton = (
        <IconAction
            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-close')}
            onPress={props.onRequestClose ?? pane.closeRight}
            accessibilityLabel={closeButtonAtStart ? t('common.back') : t('common.close')}
            style={{
                width: resolveSessionHeaderActionTargetPx(),
                height: resolveSessionHeaderActionTargetPx(),
            }}
        >
            <Icon name={closeButtonAtStart ? 'caret-left' : 'x'} size={16} color={theme.colors.text.secondary} />
        </IconAction>
    );

    return (
        <View style={styles.container}>
            {!hideHeader ? <View style={styles.header}>
                {closeButtonAtStart ? closeButton : null}
                <View style={styles.segmentedContainer}>
                    <SessionRightPanelTabBar
                        sessionId={props.sessionId}
                        terminalAvailable={terminalTabAvailable}
                        activeTab={activeTab}
                        onSelectTab={setActiveTab}
                        testIDPrefix={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-tab') ?? undefined}
                    />
                </View>
                {closeButtonAtStart ? null : closeButton}
            </View> : null}
            <View style={styles.body}>
                <View style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
                    <RightTabSurface
                        isActive={activeTab === 'git'}
                        testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-git')}
                    >
                        <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                            <SessionGitSurface sessionId={props.sessionId} scopeId={props.scopeId} />
                        </React.Suspense>
                    </RightTabSurface>
                    <RightTabSurface
                        isActive={activeTab === 'files'}
                        testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-files')}
                    >
                        <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                            <SessionBrowseFilesSurface
                                scopeId={props.scopeId}
                                sessionId={props.sessionId}
                                onOpenFile={openFileInDetails}
                                onOpenFilePinned={openFileInDetailsPinned}
                            />
                        </React.Suspense>
                    </RightTabSurface>
                    {terminalTabAvailable && (
                        <RightTabSurface
                            isActive={activeTab === 'terminal'}
                            testID={resolveOptionalSessionScreenTestId(sessionScreenTestIdsEnabled, 'session-rightpanel-surface-terminal')}
                        >
                            <React.Suspense fallback={<PaneLoadingFallback color={theme.colors.text.secondary} />}>
                                <SessionTerminalSurface sessionId={props.sessionId} scopeId={props.scopeId} />
                            </React.Suspense>
                        </RightTabSurface>
                    )}
                </View>
            </View>
        </View>
    );
});

const SessionRightPanelTabBar = React.memo((props: Readonly<{
    sessionId: string;
    terminalAvailable: boolean;
    activeTab: RightTabId;
    onSelectTab: (tabId: RightTabId) => void;
    testIDPrefix?: string;
}>) => {
    const { theme } = useUnistyles();
    const tabs = React.useMemo((): ReadonlyArray<SegmentedTab<RightTabId>> => (
        getSessionRightPanelTabs(props.terminalAvailable).map((tab) => ({
            ...tab,
            icon: <Icon name={tab.icon} size={SEGMENTED_TAB_ICON_SIZE_PX} color={theme.colors.text.secondary} />,
        }))
    ), [props.terminalAvailable, theme.colors.text.secondary]);
    return <SegmentedTabBar tabs={tabs} activeTabId={props.activeTab} onSelectTab={props.onSelectTab} testIDPrefix={props.testIDPrefix} />;
});

const PaneLoadingFallback = React.memo((props: Readonly<{ color: string }>) => {
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 24, paddingHorizontal: 16 }}>
            <ActivitySpinner size="small" color={props.color} />
            <Text style={{ marginTop: 10, fontSize: 12, color: props.color, ...Typography.default() }}>
                {t('common.loading')}
            </Text>
        </View>
    );
});

const RightTabSurface = React.memo((props: Readonly<{
    isActive: boolean;
    testID?: string;
    children: React.ReactNode;
}>) => {
    const active = props.isActive;
    const [hasMounted, setHasMounted] = React.useState(active);

    React.useLayoutEffect(() => {
        if (active) setHasMounted(true);
    }, [active]);

    if (!active && !hasMounted) return null;

    // `opacity: 0` hides a surface from eyes, not from VoiceOver or TalkBack: without this an
    // inactive native tab keeps offering its whole subtree to the screen-reader cursor, so swiping
    // through the Git tab walks into Files and the terminal. Web's `display:'none'` already
    // does this, and the sibling git sub-tab surface already carries the same pair.
    const inactiveA11yProps = Platform.OS === 'web' || active
        ? null
        : {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
        };

    return (
        <View
            testID={props.testID}
            pointerEvents={active ? 'auto' : 'none'}
            style={[
                StyleSheet.absoluteFillObject,
                {
                    opacity: active ? 1 : 0,
                    display: Platform.OS === 'web' ? (active ? 'flex' : 'none') : 'flex',
                },
            ]}
            {...(inactiveA11yProps ?? {})}
        >
            {props.children}
        </View>
    );
});
