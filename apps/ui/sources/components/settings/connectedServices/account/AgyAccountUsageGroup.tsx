import * as React from 'react';

import {
    AGY_DEFAULT_ACCOUNT_ID,
    type AgyAccountUsageMeterV1,
    type AgyAccountUsageV1,
    type ConnectedServiceQuotaMeterV1,
} from '@piggercode/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import {
    agyAccountKey,
    useAgyAccountUsage,
    type AgyMachineUsage,
} from '@/hooks/server/connectedServices/useAgyAccountUsage';
import { buildConnectedServiceQuotaGaugeMeterRows } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { t } from '@/text';
import { formatLastSeen } from '@/utils/sessions/sessionUtils';

import { GAUGE_LABEL_FORMATTER } from './AccountBlock';
import { AccountBlockView, type AccountBlockQuotaView } from './AccountBlockView';
import { resolveAccountCapacityView, resolveAccountUsageRows } from './accountBlockModel';

const NOTHING_TO_DO = async () => {};

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

/** agy's own reading in the shape every account block draws: it can be refreshed, not pinned or spent. */
function buildAgyQuotaView(
    account: AgyAccountUsageV1,
    nowMs: number,
    press: Pick<AccountBlockQuotaView, 'canRefresh' | 'isRefreshing' | 'error' | 'refresh'>,
): AccountBlockQuotaView {
    const meters = account.meters.map(toQuotaMeter);
    const capacity = resolveAccountCapacityView(meters, nowMs, GAUGE_LABEL_FORMATTER);
    return {
        ...press,
        loading: false,
        hasSnapshot: account.observedAtMs !== null,
        nowMs,
        isStale: false,
        planLabel: account.planTier,
        usageRows: resolveAccountUsageRows(buildConnectedServiceQuotaGaugeMeterRows(meters, nowMs, GAUGE_LABEL_FORMATTER)),
        capacityPct: capacity.capacityPct,
        capacityRings: capacity.rings,
        resetRows: [],
        resetAvailableCount: 0,
        pinnedMeterIds: [],
        togglePinnedMeter: null,
        consumeRecoveryCredit: NOTHING_TO_DO,
        consumeRecoveryCreditPending: false,
        consumeRecoveryCreditPendingTarget: null,
        canConsume: false,
        subscription: null,
    };
}

function accountTitle(account: AgyAccountUsageV1): string {
    if (account.email) return account.email;
    return account.accountId === AGY_DEFAULT_ACCOUNT_ID
        ? t('connectedServices.agyUsage.unknownAccount')
        : t('connectedServices.agyUsage.namedAccount', { name: account.accountId });
}

function seenLabel(machine: AgyMachineUsage, account: AgyAccountUsageV1): string {
    const unreachable = machine.status === 'unavailable';
    if (account.observedAtMs === null) {
        return unreachable
            ? t('connectedServices.agyUsage.unavailableOnMachine', { machine: machine.machineName })
            : t('connectedServices.agyUsage.noReadingOnMachine', { machine: machine.machineName });
    }
    const time = formatLastSeen(account.observedAtMs);
    return unreachable
        ? t('connectedServices.agyUsage.unreachableSeenOnMachine', { machine: machine.machineName, time })
        : t('connectedServices.agyUsage.seenOnMachine', { machine: machine.machineName, time });
}

/**
 * Gemini accounts, by machine. agy keeps its own login, so these are the numbers it last showed, in a running
 * session or at a press of refresh; a machine's status only appears beside an account the user has.
 */
export const AgyAccountUsageGroup = React.memo(function AgyAccountUsageGroup() {
    const { machines, nowMs, refreshing, didRefreshFail, refreshAccount } = useAgyAccountUsage();
    if (!machines.some((machine) => machine.accounts.length > 0 || machine.status === 'view_on_machine')) return null;
    return (
        <ItemGroup title={t('connectedServices.list.usageGroupTitle', { service: 'Gemini' })} columns={2}>
            {machines.flatMap((machine) => {
                if (machine.accounts.length > 0) {
                    return machine.accounts.map((account) => {
                        const key = agyAccountKey(machine.machineId, account.accountId);
                        return (
                            <AccountBlockView
                                key={key}
                                testID={`connected-services-index:usage:agy:${machine.machineId}:${account.accountId}`}
                                serviceId="agy"
                                profileId={key}
                                title={accountTitle(account)}
                                identityLabel={seenLabel(machine, account)}
                                quota={buildAgyQuotaView(account, nowMs, {
                                    canRefresh: machine.status === 'ok',
                                    isRefreshing: refreshing.has(key),
                                    error: didRefreshFail(machine.machineId, account) ? t('connectedServices.agyUsage.refreshFailed') : null,
                                    refresh: () => refreshAccount(machine.machineId, account.accountId),
                                })}
                            />
                        );
                    });
                }
                if (machine.status === 'ok') return [];
                return [(
                    <Item
                        key={machine.machineId}
                        testID={`connected-services-index:usage:agy:${machine.machineId}:status`}
                        title={machine.machineName}
                        subtitle={machine.status === 'view_on_machine'
                            ? t('connectedServices.agyUsage.viewOnMachine')
                            : t('connectedServices.agyUsage.unavailable')}
                        showChevron={false}
                    />
                )];
            })}
        </ItemGroup>
    );
});
