import * as React from 'react';
import { Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { MeterBar, type MeterTone } from '@/components/ui/lists/MeterBar';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export type AccountUsageCardMeter = Readonly<{
    meterId: string;
    label: string;
    remainingPct: number | null;
    resetLabel: string | null;
    tone: MeterTone;
}>;

export type AccountUsageCardProps = Readonly<{
    testID: string;
    brandXml: string | null;
    /** The agent the account belongs to, shown beside its mark. */
    providerLabel: string;
    title: string;
    subtitle: string | null;
    /** A problem with the login itself. */
    attentionLabel?: string | null;
    attentionVariant?: 'danger' | 'warning';
    /**
     * What the body shows: limits, their first load, an invitation to read them, or a plain note.
     * The invitation appears only where a read can start; elsewhere the card shows its note.
     */
    body: 'meters' | 'loading' | 'idle' | 'note';
    meters: readonly AccountUsageCardMeter[];
    note?: string | null;
    error: string | null;
    canRefresh: boolean;
    isRefreshing: boolean;
    onRefresh: () => void;
    /** Signs this account in again; absent where the app cannot. */
    onReauth?: () => void;
    /** Removes this account; absent where the app cannot. */
    onRemove?: () => void;
    isRemoving?: boolean;
    onManage?: () => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        flexGrow: 1,
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    head: {
        gap: 6,
    },
    headTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 24,
    },
    provider: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 3,
        paddingLeft: 6,
        paddingRight: 8,
        borderRadius: 7,
        backgroundColor: theme.colors.surface.inset,
    },
    providerText: {
        ...Typography.default('semiBold'),
        fontSize: 11,
        lineHeight: 14,
        color: theme.colors.text.secondary,
    },
    headSpacer: {
        flex: 1,
    },
    title: {
        ...Typography.mono('semiBold'),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.primary,
    },
    subtitle: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.tertiary,
    },
    body: {
        flexGrow: 1,
        gap: 10,
    },
    refreshingBody: {
        opacity: 0.55,
    },
    meterHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        marginBottom: 5,
    },
    meterLabel: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.secondary,
    },
    meterPercent: {
        ...Typography.mono('semiBold'),
        fontSize: 12,
        lineHeight: 16,
        fontVariant: ['tabular-nums'],
        color: theme.colors.text.primary,
    },
    meterReset: {
        ...Typography.mono(),
        fontSize: 11,
        lineHeight: 16,
        fontVariant: ['tabular-nums'],
        color: theme.colors.text.tertiary,
    },
    idle: {
        flexGrow: 1,
        minHeight: 76,
        gap: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.border.default,
    },
    idleText: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.tertiary,
    },
    note: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.text.tertiary,
    },
    skeletonRow: {
        gap: 6,
    },
    skeletonLabel: {
        width: '38%',
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.surface.inset,
    },
    skeletonTrack: {
        height: 5,
        borderRadius: 3,
        backgroundColor: theme.colors.surface.inset,
    },
    error: {
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.state.danger.foreground,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        // One height whether the card offers two actions or none.
        minHeight: 41,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.default,
    },
    actionsSpacer: {
        flex: 1,
    },
    iconAction: {
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        backgroundColor: theme.colors.surface.inset,
    },
    action: {
        minHeight: 30,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: 8,
        backgroundColor: theme.colors.surface.inset,
    },
    actionPressed: {
        opacity: 0.65,
    },
    actionText: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.text.secondary,
    },
    actionDisabled: {
        opacity: 0.45,
    },
    // A long label (English) gives way before the card's edge does.
    actionShrink: {
        flexShrink: 1,
        minWidth: 0,
    },
}));

const MeterRow = React.memo(function MeterRow(props: Readonly<{ meterTestID: string; meter: AccountUsageCardMeter }>) {
    const styles = stylesheet;
    const { meter } = props;
    const percent = meter.remainingPct === null ? '—' : `${Math.round(meter.remainingPct)}%`;
    return (
        <View accessible accessibilityLabel={[meter.label, percent, meter.resetLabel].filter(Boolean).join(', ')}>
            <View style={styles.meterHead}>
                <Text style={styles.meterLabel} numberOfLines={1}>{meter.label}</Text>
                {meter.resetLabel ? <Text style={styles.meterReset} numberOfLines={1}>{meter.resetLabel}</Text> : null}
                <Text style={styles.meterPercent}>{percent}</Text>
            </View>
            <MeterBar
                testID={props.meterTestID}
                tone={meter.tone}
                // Remaining-first fill, as on the account's own page: a full bar is a full allowance.
                fillFraction={meter.remainingPct === null ? 0 : meter.remainingPct / 100}
                height={5}
            />
        </View>
    );
});

/** One account at a glance: who it is, what is left in each limit, and what can be done about it. */
export const AccountUsageCard = React.memo(function AccountUsageCard(props: AccountUsageCardProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { testID } = props;
    const body = props.body === 'idle' && !props.canRefresh ? 'note' : props.body;
    const refreshLabel = t('connectedServices.overview.refreshAccount', { account: props.title });
    const refreshGlyph = props.isRefreshing
        ? <ActivitySpinner size={13} />
        : <Icon name="arrow-clockwise" size={13} color={theme.colors.text.secondary} />;
    return (
        <View testID={testID} style={styles.card}>
            <View style={styles.head}>
                <View style={styles.headTop}>
                    <View style={styles.provider}>
                        {props.brandXml
                            ? <SvgXml xml={props.brandXml} width={12} height={12} />
                            : <Icon name="key" size={12} color={theme.colors.text.secondary} />}
                        <Text style={styles.providerText} numberOfLines={1}>{props.providerLabel}</Text>
                    </View>
                    <View style={styles.headSpacer} />
                    {props.attentionLabel ? (
                        <StatusPill testID={`${testID}:attention`} variant={props.attentionVariant ?? 'danger'} label={props.attentionLabel} />
                    ) : null}
                </View>
                <Text style={styles.title} numberOfLines={1}>{props.title}</Text>
                {/* Every card keeps this line, so the limits below start at the same height in each. */}
                <Text style={styles.subtitle} numberOfLines={1}>{props.subtitle ?? ' '}</Text>
            </View>

            <View style={[styles.body, props.isRefreshing && styles.refreshingBody]}>
                {body === 'meters' ? props.meters.map((meter) => (
                    <MeterRow key={meter.meterId} meterTestID={`${testID}:meter:${meter.meterId}`} meter={meter} />
                )) : null}
                {body === 'loading' ? (
                    <View testID={`${testID}:loading`} style={styles.body}>
                        {[0, 1].map((row) => (
                            <View key={row} style={styles.skeletonRow}>
                                <View style={styles.skeletonLabel} />
                                <View style={styles.skeletonTrack} />
                            </View>
                        ))}
                    </View>
                ) : null}
                {body === 'idle' ? (
                    <Pressable
                        testID={`${testID}:refresh`}
                        style={({ pressed }) => [styles.idle, pressed && styles.actionPressed]}
                        disabled={props.isRefreshing}
                        onPress={props.onRefresh}
                        accessibilityRole="button"
                        accessibilityLabel={refreshLabel}
                        accessibilityState={{ busy: props.isRefreshing, disabled: props.isRefreshing }}
                    >
                        {refreshGlyph}
                        <Text style={styles.idleText}>{t('connectedServices.overview.idleHint')}</Text>
                    </Pressable>
                ) : null}
                {body === 'note' && props.note ? <Text style={styles.note}>{props.note}</Text> : null}
            </View>

            {props.error ? <Text testID={`${testID}:quota-error`} style={styles.error}>{props.error}</Text> : null}

            {/* Always drawn, at the card's foot: the same actions sit in the same place on every card. */}
            <View style={styles.actions}>
                {props.canRefresh && body !== 'idle' ? (
                    <Pressable
                        testID={`${testID}:refresh`}
                        hitSlop={7}
                        style={({ pressed }) => [styles.iconAction, pressed && styles.actionPressed]}
                        disabled={props.isRefreshing}
                        onPress={props.onRefresh}
                        accessibilityRole="button"
                        accessibilityLabel={refreshLabel}
                        accessibilityState={{ busy: props.isRefreshing, disabled: props.isRefreshing }}
                    >
                        {refreshGlyph}
                    </Pressable>
                ) : null}
                {props.onRemove ? (
                    <Pressable
                        testID={`${testID}:remove`}
                        hitSlop={7}
                        style={({ pressed }) => [styles.iconAction, pressed && styles.actionPressed, props.isRemoving && styles.actionDisabled]}
                        disabled={props.isRemoving}
                        onPress={props.onRemove}
                        accessibilityRole="button"
                        accessibilityLabel={t('connectedServices.overview.removeAccount', { account: props.title })}
                        accessibilityState={{ busy: props.isRemoving === true, disabled: props.isRemoving === true }}
                    >
                        {props.isRemoving
                            ? <ActivitySpinner size={13} />
                            : <Icon name="trash" size={14} color={theme.colors.state.danger.foreground} />}
                    </Pressable>
                ) : null}
                <View style={styles.actionsSpacer} />
                {props.onReauth ? (
                    <Pressable
                        testID={`${testID}:reauth`}
                        hitSlop={7}
                        style={({ pressed }) => [styles.action, styles.actionShrink, pressed && styles.actionPressed]}
                        onPress={props.onReauth}
                        accessibilityRole="button"
                        accessibilityLabel={t('connectedServices.overview.reauthAccount', { account: props.title })}
                    >
                        <Icon name="sign-in" size={13} color={theme.colors.text.secondary} />
                        <Text style={styles.actionText} numberOfLines={1}>{t('connectedServices.overview.reauth')}</Text>
                    </Pressable>
                ) : null}
                {props.onManage ? (
                    <Pressable
                        testID={`${testID}:manage`}
                        hitSlop={7}
                        style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
                        onPress={props.onManage}
                        accessibilityRole="button"
                        accessibilityLabel={t('connectedServices.overview.manageAccount', { account: props.title })}
                    >
                        <Text style={styles.actionText} numberOfLines={1}>{t('connectedServices.overview.manage')}</Text>
                        <Icon name="caret-right" size={12} color={theme.colors.text.tertiary} />
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
});
