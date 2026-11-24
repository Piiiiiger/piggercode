import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import type { AgyAccountUsageMeterV1, ConnectedServiceId, ConnectedServiceQuotaMeterV1 } from '@piggercode/protocol';

import { PROVIDER_LOGO_SVG_XML } from '@/agents/registry/providerLogoSvgXml';
import { resolveConnectedServiceBrandIconXml } from '@/agents/registry/resolveConnectedServiceBrandIconXml';
import { useConnectedServiceQuotaSnapshot } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshot';
import { buildConnectedServiceQuotaGaugeMeterRows } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { resolveQuotaTone } from '@/sync/domains/connectedServices/resolveQuotaTone';
import { shouldHideQuotaForCredentialStatus } from '@/sync/domains/connectedServices/shouldHideQuotaForCredentialStatus';
import { t } from '@/text';
import { formatLastSeen } from '@/utils/sessions/sessionUtils';

import { GAUGE_LABEL_FORMATTER } from '../account/AccountBlock';
import { AccountUsageCard, type AccountUsageCardMeter } from './AccountUsageCard';
import type { AgyAccountEntry, ConnectedAccountEntry } from './accountsOverviewModel';

/** Lets the page's "refresh all" reach the cards on screen, each through its own refresh owner. */
export type RegisterAccountRefresh = (key: string, refresh: () => Promise<void>) => () => void;

function toCardMeters(meters: readonly ConnectedServiceQuotaMeterV1[], nowMs: number): AccountUsageCardMeter[] {
    return buildConnectedServiceQuotaGaugeMeterRows(meters, nowMs, GAUGE_LABEL_FORMATTER).map((row) => ({
        meterId: row.meterId,
        label: row.label,
        remainingPct: row.remainingPct,
        resetLabel: row.resetLabel,
        tone: resolveQuotaTone(row.remainingPct),
    }));
}

export const ConnectedAccountCard = React.memo(function ConnectedAccountCard(props: Readonly<{
    entry: ConnectedAccountEntry;
    onManage: (serviceId: ConnectedServiceId) => void;
    registerRefresh: RegisterAccountRefresh;
}>) {
    const { theme } = useUnistyles();
    const { entry, onManage, registerRefresh } = props;
    const needsReauth = shouldHideQuotaForCredentialStatus(entry.rawStatus);
    const hook = useConnectedServiceQuotaSnapshot({
        serviceId: entry.serviceId,
        profileId: entry.profileId,
        credentialHealthStatus: entry.rawStatus,
        enabled: entry.showsUsage,
    });
    const canRefresh = entry.showsUsage && !needsReauth && hook.canRefresh;
    const { refresh } = hook;

    React.useEffect(() => (canRefresh ? registerRefresh(entry.key, refresh) : undefined), [
        canRefresh,
        entry.key,
        refresh,
        registerRefresh,
    ]);

    const handleRefresh = React.useCallback(() => {
        void refresh();
    }, [refresh]);
    const handleManage = React.useCallback(() => onManage(entry.serviceId), [entry.serviceId, onManage]);

    const planLabel = hook.snapshot?.planLabel ?? null;
    const subtitle = planLabel && entry.identityLabel
        ? t('connectedServices.account.planEmailSubtitle', { plan: planLabel, email: entry.identityLabel })
        : entry.identityLabel ?? planLabel;
    const showsMeters = entry.showsUsage && !needsReauth;
    const meters = showsMeters && hook.snapshot ? toCardMeters(hook.snapshot.meters, hook.nowMs) : [];
    // A reading can hold no limit at all: that says the same as an account without usage data.
    const body = !showsMeters || (hook.snapshot && meters.length === 0)
        ? 'note'
        : hook.snapshot ? 'meters' : hook.loading ? 'loading' : 'idle';

    return (
        <AccountUsageCard
            testID={`connected-services-index:usage:${entry.serviceId}:${entry.profileId}`}
            brandXml={resolveConnectedServiceBrandIconXml(entry.serviceId, theme)}
            title={entry.title}
            subtitle={subtitle}
            // The page summary counts these same marks.
            attentionLabel={entry.health === 'error'
                ? t('connectedServices.detail.profiles.needsReauth')
                : entry.health === 'attention' ? t('connectedServices.detail.profiles.refreshFailedRetryable') : null}
            attentionVariant={entry.health === 'error' ? 'danger' : 'warning'}
            body={body}
            meters={meters}
            note={needsReauth ? t('connectedServices.overview.reauthHint') : t('connectedServices.overview.noUsage')}
            error={showsMeters ? hook.error : null}
            canRefresh={canRefresh}
            isRefreshing={hook.isRefreshing}
            onRefresh={handleRefresh}
            onManage={handleManage}
        />
    );
});

function agyMeterLabel(meterId: string): string {
    switch (meterId) {
        case 'gemini-5h': return t('connectedServices.agyUsage.meters.gemini5h');
        case 'gemini-weekly': return t('connectedServices.agyUsage.meters.geminiWeekly');
        case '3p-5h': return t('connectedServices.agyUsage.meters.thirdParty5h');
        case '3p-weekly': return t('connectedServices.agyUsage.meters.thirdPartyWeekly');
        default: return meterId;
    }
}

function toQuotaMeter(meter: AgyAccountUsageMeterV1): ConnectedServiceQuotaMeterV1 {
    const remainingPct = meter.remainingFraction * 100;
    return {
        meterId: meter.meterId,
        label: agyMeterLabel(meter.meterId),
        used: null,
        limit: null,
        remainingPct,
        usedPct: 100 - remainingPct,
        utilizationPct: 100 - remainingPct,
        resetAtMs: meter.resetAtMs,
        resetsAt: meter.resetAtMs,
        unit: 'unknown',
        status: 'ok',
        details: {},
    };
}

function seenLabel(entry: AgyAccountEntry): string {
    const machine = entry.machine.machineName;
    const unreachable = entry.machine.status === 'unavailable';
    if (entry.account.observedAtMs === null) {
        return unreachable
            ? t('connectedServices.agyUsage.unavailableOnMachine', { machine })
            : t('connectedServices.agyUsage.noReadingOnMachine', { machine });
    }
    const time = formatLastSeen(entry.account.observedAtMs);
    return unreachable
        ? t('connectedServices.agyUsage.unreachableSeenOnMachine', { machine, time })
        : t('connectedServices.agyUsage.seenOnMachine', { machine, time });
}

/** agy keeps its own login: these are the numbers it last showed, in a running session or at a press. */
export const AgyAccountCard = React.memo(function AgyAccountCard(props: Readonly<{
    entry: AgyAccountEntry;
    nowMs: number;
    isRefreshing: boolean;
    refreshFailed: boolean;
    refreshAccount: (machineId: string, accountId: string) => Promise<void>;
    registerRefresh: RegisterAccountRefresh;
}>) {
    const { theme } = useUnistyles();
    const { entry, refreshAccount, registerRefresh } = props;
    const { machineId } = entry.machine;
    const { accountId } = entry.account;
    const canRefresh = entry.machine.status === 'ok';
    const refresh = React.useCallback(() => refreshAccount(machineId, accountId), [accountId, machineId, refreshAccount]);

    React.useEffect(() => (canRefresh ? registerRefresh(entry.key, refresh) : undefined), [
        canRefresh,
        entry.key,
        refresh,
        registerRefresh,
    ]);

    const handleRefresh = React.useCallback(() => {
        void refresh();
    }, [refresh]);
    const { planTier, observedAtMs, meters } = entry.account;
    const label = seenLabel(entry);

    return (
        <AccountUsageCard
            testID={`connected-services-index:usage:agy:${machineId}:${accountId}`}
            brandXml={PROVIDER_LOGO_SVG_XML.agy?.(theme) ?? null}
            title={entry.title}
            subtitle={planTier ? t('connectedServices.account.planEmailSubtitle', { plan: planTier, email: label }) : label}
            body={observedAtMs === null ? 'idle' : 'meters'}
            meters={toCardMeters(meters.map(toQuotaMeter), props.nowMs)}
            note={t('connectedServices.overview.unreachableHint')}
            error={props.refreshFailed ? t('connectedServices.agyUsage.refreshFailed') : null}
            canRefresh={canRefresh}
            isRefreshing={props.isRefreshing}
            onRefresh={handleRefresh}
        />
    );
});
