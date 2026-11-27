import * as React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AGY_DEFAULT_ACCOUNT_ID, type ConnectedServiceId } from '@piggercode/protocol';

import { getAgentCore } from '@/agents/catalog/catalog';
import { PROVIDER_LOGO_SVG_XML } from '@/agents/registry/providerLogoSvgXml';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { resolveItemGroupContentHorizontalInsetPx } from '@/components/ui/lists/itemGroupSpacing';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { agyAccountLabel } from '@/sync/domains/connectedServices/agyAccountLabel';
import { agyAccountKey, requestAgyAccountUsageRead, useAgyAccountUsage } from '@/hooks/server/connectedServices/useAgyAccountUsage';
import { Modal } from '@/modal';
import type { resolveConnectedServiceProfileLabel } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { t } from '@/text';

import { resolveConnectedServiceDisplayName } from '../model/resolveConnectedServiceDisplayName';
import { AddAccountGrid, type AddAccountRow } from './AddAccountGrid';
import { runAgyAccountLoginStep } from '@/sync/ops/agyAccountLogin';

import { AgyAccountCard, ConnectedAccountCard, type ConnectedAccountAction, type RegisterAccountRefresh } from './AccountCards';
import {
    ACCOUNT_GRID_GAP_PX,
    buildAgyAccountEntries,
    buildConnectedAccountEntries,
    countAccountsByTab,
    filterAccountEntries,
    groupAccountEntriesIntoSections,
    orderAccountEntries,
    resolveAccountGridItemWidth,
    resolveVisibleAccountTabs,
    type AccountEntry,
    type AccountsTabId,
    type AgyAccountEntry,
} from './accountsOverviewModel';

const stylesheet = StyleSheet.create((theme) => ({
    page: {
        width: '100%',
        alignSelf: 'center',
        gap: 20,
        paddingTop: 20,
        paddingBottom: 12,
    },
    header: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
    },
    headerCopy: {
        flexShrink: 1,
        gap: 6,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: -0.4,
        color: theme.colors.text.primary,
    },
    meta: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
    },
    metaCursor: {
        width: 3,
        height: 12,
        borderRadius: 1.5,
        backgroundColor: theme.colors.state.success.foreground,
    },
    metaText: {
        ...Typography.mono(),
        fontSize: 12,
        lineHeight: 16,
        fontVariant: ['tabular-nums'],
        color: theme.colors.text.secondary,
    },
    metaAttention: {
        color: theme.colors.state.danger.foreground,
    },
    refreshAll: {
        minHeight: 36,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 18,
        backgroundColor: theme.colors.button.primary.background,
    },
    refreshAllPressed: {
        opacity: 0.8,
    },
    refreshAllDisabled: {
        opacity: 0.5,
    },
    refreshAllText: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.button.primary.tint,
    },
    workbench: {
        gap: 14,
    },
    tabsRail: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
    },
    tabs: {
        flexDirection: 'row',
        gap: 4,
    },
    tab: {
        minHeight: 40,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabActive: {
        borderBottomColor: theme.colors.text.primary,
    },
    tabPressed: {
        opacity: 0.65,
    },
    tabText: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
    },
    tabTextActive: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    tabCount: {
        minWidth: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        alignItems: 'center',
        backgroundColor: theme.colors.surface.inset,
    },
    tabCountText: {
        ...Typography.mono(),
        fontSize: 10.5,
        lineHeight: 16,
        fontVariant: ['tabular-nums'],
        color: theme.colors.text.secondary,
    },
    search: {
        maxWidth: 340,
        height: 36,
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        backgroundColor: theme.colors.input.background,
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
        height: '100%',
        padding: 0,
        fontSize: 13,
        color: theme.colors.input.text,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        gap: ACCOUNT_GRID_GAP_PX,
    },
    gridItem: {
        flexDirection: 'column',
    },
    section: {
        gap: 8,
    },
    sectionHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingTop: 4,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
    },
    sectionCount: {
        ...Typography.mono(),
        fontSize: 12,
        lineHeight: 18,
        fontVariant: ['tabular-nums'],
        color: theme.colors.text.tertiary,
    },
    empty: {
        minHeight: 104,
        padding: 16,
        gap: 4,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.border.default,
    },
    emptyTitle: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        lineHeight: 19,
        color: theme.colors.text.primary,
    },
    emptyHint: {
        fontSize: 12,
        lineHeight: 17,
        textAlign: 'center',
        color: theme.colors.text.tertiary,
    },
    machineNote: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.text.tertiary,
    },
}));

function tabLabel(tab: AccountsTabId): string {
    switch (tab) {
        case 'all': return t('connectedServices.overview.tabAll');
        case 'codex': return t(getAgentCore('codex').displayNameKey);
        case 'claude': return t(getAgentCore('claude').displayNameKey);
        case 'agy': return t('connectedServices.overview.tabGemini');
        case 'other': return t('connectedServices.overview.tabOther');
    }
}

const AccountsTabs = React.memo(function AccountsTabs(props: Readonly<{
    tabs: readonly AccountsTabId[];
    counts: Readonly<Record<AccountsTabId, number>>;
    active: AccountsTabId;
    onChange: (tab: AccountsTabId) => void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    return (
        <View style={styles.tabsRail}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabs}
                accessibilityRole="tablist"
            >
                {props.tabs.map((tab) => {
                    const selected = tab === props.active;
                    const logo = tab === 'all' || tab === 'other' ? null : PROVIDER_LOGO_SVG_XML[tab]?.(theme) ?? null;
                    return (
                        <Pressable
                            key={tab}
                            testID={`connected-services-index:tab:${tab}`}
                            style={({ pressed }) => [styles.tab, selected && styles.tabActive, pressed && styles.tabPressed]}
                            onPress={() => props.onChange(tab)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected }}
                            accessibilityLabel={`${tabLabel(tab)}, ${props.counts[tab]}`}
                        >
                            {logo
                                ? <SvgXml xml={logo} width={15} height={15} />
                                : <Icon name={tab === 'all' ? 'squares-four' : 'key'} size={15} color={theme.colors.text.secondary} />}
                            <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tabLabel(tab)}</Text>
                            <View style={styles.tabCount}>
                                <Text style={styles.tabCountText}>{props.counts[tab]}</Text>
                            </View>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
});

/**
 * The page's main surface: how many accounts there are, what is left on each, and how to add one.
 * The tab rail sits apart from the search so the two never compete for attention.
 */
export const AccountsOverview = React.memo(function AccountsOverview(props: Readonly<{
    services: Parameters<typeof buildConnectedAccountEntries>[0]['services'];
    labelsByKey: Parameters<typeof resolveConnectedServiceProfileLabel>[0]['labelsByKey'];
    usageEnabled: boolean;
    addRows: readonly AddAccountRow[];
    onOpenService: (serviceId: ConnectedServiceId) => void;
    onAddAccount: (serviceId: ConnectedServiceId) => void;
    onReauthAccount: ConnectedAccountAction;
    /** Resolves once the person answered and, when they confirmed, the account is gone or the removal failed. */
    onRemoveAccount: (serviceId: ConnectedServiceId, profileId: string) => Promise<void>;
    onAddGeminiLogin: (machine: Readonly<{ machineId: string; machineName: string }>) => void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { width: windowWidth } = useWindowDimensions();
    const maxWidth = useLayoutMaxWidth();
    const inset = resolveItemGroupContentHorizontalInsetPx();
    const agy = useAgyAccountUsage();
    const [selectedTab, setSelectedTab] = React.useState<AccountsTabId>('all');
    const [query, setQuery] = React.useState('');
    const [isRefreshingAll, setRefreshingAll] = React.useState(false);
    const [refreshableCount, setRefreshableCount] = React.useState(0);
    const [measuredWidth, setMeasuredWidth] = React.useState<number | null>(null);

    const connectedEntries = React.useMemo(() => buildConnectedAccountEntries({
        services: props.services,
        labelsByKey: props.labelsByKey,
        usageEnabled: props.usageEnabled,
        serviceLabel: (serviceId) => resolveConnectedServiceDisplayName(serviceId, t),
    }), [props.labelsByKey, props.services, props.usageEnabled]);
    // Gemini readings land every half minute; the other cards keep their entries and do not draw again.
    const agyEntries = React.useMemo(() => buildAgyAccountEntries({
        agyMachines: agy.machines,
        agyAccountTitle: agyAccountLabel,
        agyServiceLabel: t('connectedServices.overview.tabGemini'),
    }), [agy.machines]);
    const entries = React.useMemo(() => orderAccountEntries(connectedEntries, agyEntries), [agyEntries, connectedEntries]);
    const counts = React.useMemo(() => countAccountsByTab(entries), [entries]);
    const tabs = React.useMemo(() => resolveVisibleAccountTabs(counts), [counts]);
    // A tab whose last account went away falls back to everything rather than to an empty page.
    const activeTab = tabs.includes(selectedTab) ? selectedTab : 'all';
    const visible = React.useMemo(() => filterAccountEntries(entries, activeTab, query), [activeTab, entries, query]);
    const sections = React.useMemo(() => groupAccountEntriesIntoSections(visible, activeTab), [activeTab, visible]);
    const [removing, setRemoving] = React.useState<ReadonlySet<string>>(() => new Set());
    const markRemoving = React.useCallback((key: string, on: boolean) => setRemoving((previous) => {
        if (previous.has(key) === on) return previous;
        const next = new Set(previous);
        if (on) next.add(key);
        else next.delete(key);
        return next;
    }), []);
    // The same test that puts a mark on a card.
    const attentionCount = entries.filter((entry) => entry.health !== 'healthy').length;
    const machineNotes = activeTab === 'all' || activeTab === 'agy'
        ? agy.machines.filter((machine) => machine.accounts.length === 0 && machine.status !== 'ok')
        : [];
    const showMachineNotes = counts.agy > 0 || machineNotes.some((machine) => machine.status === 'view_on_machine');

    const refreshers = React.useRef(new Map<string, () => Promise<void>>());
    const registerRefresh = React.useCallback<RegisterAccountRefresh>((key, refresh) => {
        refreshers.current.set(key, refresh);
        setRefreshableCount(refreshers.current.size);
        return () => {
            if (refreshers.current.get(key) === refresh) refreshers.current.delete(key);
            setRefreshableCount(refreshers.current.size);
        };
    }, []);
    const refreshAll = React.useCallback(async () => {
        setRefreshingAll(true);
        await Promise.allSettled([...refreshers.current.values()].map((refresh) => refresh()));
        setRefreshingAll(false);
    }, []);

    // A Google login can be added to agy on a Linux machine whose agy answers this page: a machine with agy
    // installed always lists at least its main login.
    const geminiMachines = React.useMemo(
        () => agy.machines.filter((machine) => machine.status === 'ok' && machine.platform === 'linux' && machine.accounts.length > 0),
        [agy.machines],
    );
    const { onAddGeminiLogin } = props;
    const addGemini = React.useCallback(() => {
        const [first, ...others] = geminiMachines;
        if (!first) return;
        if (others.length === 0) {
            onAddGeminiLogin(first);
            return;
        }
        void Modal.alert(t('connectedServices.agyLogin.pickMachine'), undefined, [
            ...geminiMachines.map((machine) => ({
                text: machine.machineName,
                style: 'default' as const,
                onPress: () => onAddGeminiLogin(machine),
            })),
            { text: t('common.cancel'), style: 'cancel' as const },
        ]);
    }, [geminiMachines, onAddGeminiLogin]);
    const geminiTile = React.useMemo(
        () => (geminiMachines.length > 0 ? { accountCount: counts.agy, onAdd: addGemini } : null),
        [addGemini, counts.agy, geminiMachines.length],
    );

    // Signing in again is adding the same Google account again: the machine then signs that login in again in place.
    const reauthAgy = React.useCallback((entry: AgyAccountEntry) => onAddGeminiLogin(entry.machine), [onAddGeminiLogin]);
    const removeAgy = React.useCallback((entry: AgyAccountEntry) => {
        void (async () => {
            const confirmed = await Modal.confirm(
                t('connectedServices.agyLogin.removeConfirmTitle'),
                t('connectedServices.agyLogin.removeConfirmBody', { account: entry.title, machine: entry.machine.machineName }),
                { confirmText: t('connectedServices.overview.remove'), cancelText: t('common.cancel'), destructive: true },
            );
            if (!confirmed) return;
            markRemoving(entry.key, true);
            const step = await runAgyAccountLoginStep({
                machineId: entry.machine.machineId,
                request: { action: 'remove', accountId: entry.account.accountId },
            });
            // The list comes from the machine: read it again either way, so the page shows what is there.
            requestAgyAccountUsageRead();
            markRemoving(entry.key, false);
            if (step.kind !== 'removed') await Modal.alert(t('common.error'), t('connectedServices.agyLogin.removeFailed'));
        })();
    }, [markRemoving]);
    const { onRemoveAccount } = props;
    const removeConnected = React.useCallback<ConnectedAccountAction>((serviceId, profileId) => {
        const key = `${serviceId}:${profileId}`;
        markRemoving(key, true);
        void onRemoveAccount(serviceId, profileId).finally(() => markRemoving(key, false));
    }, [markRemoving, onRemoveAccount]);
    /** Only an added login on a Linux machine that answers can be signed in again or removed from here. */
    const agyManageable = React.useCallback((entry: AgyAccountEntry) => (
        entry.account.accountId !== AGY_DEFAULT_ACCOUNT_ID && entry.machine.status === 'ok' && entry.machine.platform === 'linux'
    ), []);

    const renderCard = (entry: AccountEntry) => (
        <View
            key={entry.key}
            testID={`connected-services-index:cell:${entry.key}`}
            style={[styles.gridItem, { width: itemWidth }]}
        >
            {entry.kind === 'connected' ? (
                <ConnectedAccountCard
                    entry={entry}
                    providerLabel={entry.tab === 'other'
                        ? resolveConnectedServiceDisplayName(entry.serviceId, t)
                        : tabLabel(entry.tab)}
                    onManage={props.onOpenService}
                    onReauth={props.onReauthAccount}
                    onRemove={removeConnected}
                    isRemoving={removing.has(entry.key)}
                    registerRefresh={registerRefresh}
                />
            ) : (
                <AgyAccountCard
                    entry={entry}
                    providerLabel={tabLabel('agy')}
                    nowMs={agy.nowMs}
                    isRefreshing={agy.refreshing.has(agyAccountKey(entry.machine.machineId, entry.account.accountId))}
                    refreshFailed={agy.didRefreshFail(entry.machine.machineId, entry.account)}
                    refreshAccount={agy.refreshAccount}
                    onReauth={agyManageable(entry) ? reauthAgy : undefined}
                    onRemove={agyManageable(entry) ? removeAgy : undefined}
                    isRemoving={removing.has(entry.key)}
                    registerRefresh={registerRefresh}
                />
            )}
        </View>
    );

    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        // Down, never up: a row of cards must fit in the width the page really has.
        const next = Math.floor(event.nativeEvent.layout.width);
        // A pass at no width (the page off screen) says nothing about the room the cards have.
        if (next <= 0) return;
        setMeasuredWidth((previous) => (previous === next ? previous : next));
    }, []);
    const itemWidth = resolveAccountGridItemWidth(measuredWidth ?? Math.min(windowWidth, maxWidth) - 2 * inset);

    const emptyTitle = query.trim()
        ? t('connectedServices.overview.searchEmptyTitle')
        : activeTab === 'all'
            ? t('connectedServices.overview.emptyTitle')
            : t('connectedServices.overview.tabEmptyTitle', { service: tabLabel(activeTab) });

    return (
        <View style={[styles.page, { maxWidth, paddingHorizontal: inset }]}>
            <View style={styles.header}>
                <View style={styles.headerCopy}>
                    <Text style={styles.title} accessibilityRole="header">{t('connectedServices.title')}</Text>
                    <View style={styles.meta}>
                        <View style={styles.metaCursor} />
                        <Text testID="connected-services-index:meta" style={styles.metaText}>
                            {t('connectedServices.overview.metaAccounts', { count: entries.length })}
                        </Text>
                        {attentionCount > 0 ? (
                            <Text testID="connected-services-index:meta-attention" style={[styles.metaText, styles.metaAttention]}>
                                {`· ${t('connectedServices.overview.metaAttention', { count: attentionCount })}`}
                            </Text>
                        ) : null}
                    </View>
                </View>
                <Pressable
                    testID="connected-services-index:refresh-all"
                    style={({ pressed }) => [
                        styles.refreshAll,
                        pressed && styles.refreshAllPressed,
                        (isRefreshingAll || refreshableCount === 0) && styles.refreshAllDisabled,
                    ]}
                    disabled={isRefreshingAll || refreshableCount === 0}
                    onPress={() => void refreshAll()}
                    accessibilityRole="button"
                    accessibilityLabel={t('connectedServices.overview.refreshAll')}
                    accessibilityState={{ busy: isRefreshingAll, disabled: isRefreshingAll || refreshableCount === 0 }}
                >
                    {isRefreshingAll
                        ? <ActivitySpinner size={14} color={theme.colors.button.primary.tint} />
                        : <Icon name="arrow-clockwise" size={14} color={theme.colors.button.primary.tint} />}
                    <Text style={styles.refreshAllText}>{t('connectedServices.overview.refreshAll')}</Text>
                </Pressable>
            </View>

            <View testID="connected-services-index:accounts" style={styles.workbench} onLayout={onLayout}>
                <AccountsTabs tabs={tabs} counts={counts} active={activeTab} onChange={setSelectedTab} />

                <View style={styles.search}>
                    <Icon name="magnifying-glass" size={15} color={theme.colors.text.tertiary} />
                    <TextInput
                        testID="connected-services-index:search"
                        style={styles.searchInput}
                        value={query}
                        onChangeText={setQuery}
                        placeholder={t('connectedServices.overview.searchPlaceholder')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        accessibilityLabel={t('connectedServices.overview.searchPlaceholder')}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {query ? (
                        <Pressable
                            testID="connected-services-index:search-clear"
                            hitSlop={10}
                            onPress={() => setQuery('')}
                            accessibilityRole="button"
                            accessibilityLabel={t('connectedServices.overview.searchClear')}
                        >
                            <Icon name="x" size={14} color={theme.colors.text.tertiary} />
                        </Pressable>
                    ) : null}
                </View>

                {sections.length > 0 ? sections.map((section) => (section.tab === null ? (
                    <View key="all" style={styles.grid}>{section.entries.map(renderCard)}</View>
                ) : (
                    <View key={section.tab} testID={`connected-services-index:section:${section.tab}`} style={styles.section}>
                        <View style={styles.sectionHead}>
                            <Text style={styles.sectionTitle} accessibilityRole="header">{tabLabel(section.tab)}</Text>
                            <Text style={styles.sectionCount}>{section.entries.length}</Text>
                        </View>
                        <View style={styles.grid}>{section.entries.map(renderCard)}</View>
                    </View>
                ))                ) : (
                    <View testID="connected-services-index:empty" style={styles.empty}>
                        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
                        {query.trim() ? null : (
                            <Text style={styles.emptyHint}>{t('connectedServices.overview.emptyHint')}</Text>
                        )}
                    </View>
                )}

                {showMachineNotes ? machineNotes.map((machine) => (
                    <Text
                        key={machine.machineId}
                        testID={`connected-services-index:usage:agy:${machine.machineId}:status`}
                        style={styles.machineNote}
                    >
                        {t('connectedServices.agyUsage.machineNote', {
                            machine: machine.machineName,
                            status: machine.status === 'view_on_machine'
                                ? t('connectedServices.agyUsage.viewOnMachine')
                                : t('connectedServices.agyUsage.unavailable'),
                        })}
                    </Text>
                )) : null}
            </View>

            <AddAccountGrid rows={props.addRows} itemWidth={itemWidth} onAdd={props.onAddAccount} gemini={geminiTile} />
        </View>
    );
});
