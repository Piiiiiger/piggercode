import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { ConnectedServiceId } from '@piggercode/protocol';

import { resolveConnectedServiceBrandIconXml } from '@/agents/registry/resolveConnectedServiceBrandIconXml';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { ConnectedServiceRegistryEntry } from '@/sync/domains/connectedServices/connectedServiceRegistry';
import { t } from '@/text';

import { ACCOUNT_GRID_GAP_PX } from './accountsOverviewModel';

export type AddAccountRow = Readonly<{
    serviceId: ConnectedServiceId;
    entry: ConnectedServiceRegistryEntry;
    label: string;
    accountCount: number;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    section: {
        gap: 10,
    },
    sectionLabel: {
        // The inset an ItemGroup title has over its cards, so these headings line up with the groups below.
        paddingHorizontal: Platform.select({ ios: 16, default: 12 }),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: ACCOUNT_GRID_GAP_PX,
    },
    tile: {
        minHeight: 64,
        paddingVertical: 12,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    tilePressed: {
        opacity: 0.65,
    },
    brand: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.inset,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        lineHeight: 19,
        color: theme.colors.text.primary,
    },
    method: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.tertiary,
    },
    plus: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
    },
}));

function methodLabel(row: AddAccountRow): string {
    if (row.entry.supportsOauth) return t('connectedServices.overview.methodOauth');
    return row.entry.tokenKind === 'api-key'
        ? t('connectedServices.overview.methodApiKey')
        : t('connectedServices.overview.methodToken');
}

const AddAccountTile = React.memo(function AddAccountTile(props: Readonly<{
    row: AddAccountRow;
    width: number;
    onOpen: (serviceId: ConnectedServiceId) => void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { row, onOpen } = props;
    const brandXml = resolveConnectedServiceBrandIconXml(row.serviceId, theme);
    const method = methodLabel(row);
    return (
        <Pressable
            testID={`connected-services-index:add:${row.serviceId}`}
            style={({ pressed }) => [styles.tile, { width: props.width }, pressed && styles.tilePressed]}
            onPress={() => onOpen(row.serviceId)}
            accessibilityRole="button"
            accessibilityLabel={t('connectedServices.overview.addAccountA11y', { service: row.label })}
        >
            <View style={styles.brand}>
                {brandXml
                    ? <SvgXml xml={brandXml} width={20} height={20} />
                    : <Icon name="key" size={18} color={theme.colors.text.secondary} />}
            </View>
            <View style={styles.copy}>
                <Text style={styles.name} numberOfLines={1}>{row.label}</Text>
                <Text style={styles.method} numberOfLines={1}>
                    {row.accountCount > 0
                        ? t('connectedServices.overview.methodWithCount', { method, count: row.accountCount })
                        : method}
                </Text>
            </View>
            <View style={styles.plus}>
                <Icon name="plus" size={13} color={theme.colors.text.secondary} />
            </View>
        </Pressable>
    );
});

/** The ways in: browser sign-ins first, keys and tokens after them. */
export const AddAccountGrid = React.memo(function AddAccountGrid(props: Readonly<{
    rows: readonly AddAccountRow[];
    itemWidth: number;
    onOpen: (serviceId: ConnectedServiceId) => void;
}>) {
    const styles = stylesheet;
    const signIns = props.rows.filter((row) => row.entry.supportsOauth);
    const others = props.rows.filter((row) => !row.entry.supportsOauth);
    const renderTiles = (rows: readonly AddAccountRow[]) => (
        <View style={styles.grid}>
            {rows.map((row) => (
                <AddAccountTile key={row.serviceId} row={row} width={props.itemWidth} onOpen={props.onOpen} />
            ))}
        </View>
    );
    return (
        <>
            {signIns.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.sectionLabel} accessibilityRole="header">
                        {t('connectedServices.overview.addAccounts')}
                    </Text>
                    {renderTiles(signIns)}
                </View>
            ) : null}
            {others.length > 0 ? (
                <View style={styles.section}>
                    <Text style={styles.sectionLabel} accessibilityRole="header">
                        {t('connectedServices.overview.otherMethods')}
                    </Text>
                    {renderTiles(others)}
                </View>
            ) : null}
        </>
    );
});
