import {
    isConnectedServiceSubscriptionLogin,
    type AgyAccountUsageV1,
    type ConnectedServiceId,
} from '@piggercode/protocol';

import { resolveAgentIdFromConnectedServiceId } from '@/agents/registry/registryCore';
import type { AgyMachineUsage } from '@/hooks/server/connectedServices/useAgyAccountUsage';
import { resolveConnectedServiceProfileLabel } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { deriveAccountHealth, type AccountHealth } from '@/sync/domains/connectedServices/deriveAccountHealth';
import { resolveConnectedServiceCredentialHealthStatus } from '@/sync/domains/connectedServices/resolveConnectedServiceCredentialHealthStatus';

import { resolveConnectedServiceProfileIdentityDisplay } from '../model/resolveConnectedServiceIdentityDisplay';

export type AccountsTabId = 'all' | 'codex' | 'claude' | 'agy' | 'other';
type AccountTab = Exclude<AccountsTabId, 'all'>;

const TAB_ORDER: readonly AccountTab[] = ['codex', 'claude', 'agy', 'other'];
const HEALTH_RANK: Readonly<Record<AccountHealth, number>> = { error: 0, attention: 1, healthy: 2 };

const GRID_MIN_ITEM_WIDTH_PX = 280;
const GRID_MAX_COLUMNS = 3;
export const ACCOUNT_GRID_GAP_PX = 12;

type AccountEntryBase = Readonly<{
    key: string;
    tab: AccountTab;
    title: string;
    health: AccountHealth;
    searchText: string;
    /** Where the account's owner listed it; agy lists the real home's login first. */
    order: number;
}>;

export type ConnectedAccountEntry = AccountEntryBase & Readonly<{
    kind: 'connected';
    serviceId: ConnectedServiceId;
    profileId: string;
    identityLabel: string | null;
    rawStatus: unknown;
    /** A subscription login with limits to read; an API key has none. */
    showsUsage: boolean;
}>;

export type AgyAccountEntry = AccountEntryBase & Readonly<{
    kind: 'agy';
    machine: AgyMachineUsage;
    account: AgyAccountUsageV1;
}>;

export type AccountEntry = ConnectedAccountEntry | AgyAccountEntry;

function tabForService(serviceId: ConnectedServiceId): AccountTab {
    const agentId = resolveAgentIdFromConnectedServiceId(serviceId);
    return agentId === 'codex' || agentId === 'claude' ? agentId : 'other';
}

function searchTextOf(parts: ReadonlyArray<string | null | undefined>): string {
    return parts.filter(Boolean).join(' ').toLowerCase();
}

/** The relay's accounts, one entry per login. */
export function buildConnectedAccountEntries(params: Readonly<{
    services: ReadonlyArray<Readonly<{
        serviceId: ConnectedServiceId;
        profiles: ReadonlyArray<Readonly<{ profileId: string; status?: unknown; providerEmail?: unknown }>>;
    }>>;
    labelsByKey: Parameters<typeof resolveConnectedServiceProfileLabel>[0]['labelsByKey'];
    usageEnabled: boolean;
    serviceLabel: (serviceId: ConnectedServiceId) => string;
}>): readonly ConnectedAccountEntry[] {
    return params.services.flatMap((service) => service.profiles
        .filter((profile) => profile.profileId.trim().length > 0)
        .map((profile): ConnectedAccountEntry => {
            const identity = resolveConnectedServiceProfileIdentityDisplay({
                profileId: profile.profileId,
                label: resolveConnectedServiceProfileLabel({
                    labelsByKey: params.labelsByKey,
                    serviceId: service.serviceId,
                    profileId: profile.profileId,
                }),
                providerEmail: typeof profile.providerEmail === 'string' ? profile.providerEmail : '',
            });
            return {
                kind: 'connected',
                key: `${service.serviceId}:${profile.profileId}`,
                tab: tabForService(service.serviceId),
                serviceId: service.serviceId,
                profileId: profile.profileId,
                title: identity.primaryLabel,
                identityLabel: identity.secondaryLabel ?? null,
                rawStatus: profile.status,
                health: deriveAccountHealth({
                    status: resolveConnectedServiceCredentialHealthStatus(profile.status),
                    capacityPct: null,
                }),
                showsUsage: params.usageEnabled && isConnectedServiceSubscriptionLogin(service.serviceId),
                order: 0,
                searchText: searchTextOf([
                    identity.primaryLabel,
                    identity.secondaryLabel,
                    params.serviceLabel(service.serviceId),
                ]),
            };
        }));
}

/** Each machine's Gemini logins, as the machine lists them: its real home's login first. */
export function buildAgyAccountEntries(params: Readonly<{
    agyMachines: readonly AgyMachineUsage[];
    agyAccountTitle: (account: AgyAccountUsageV1) => string;
    agyServiceLabel: string;
}>): readonly AgyAccountEntry[] {
    return params.agyMachines
        .flatMap((machine) => machine.accounts.map((account) => ({ machine, account })))
        .map(({ machine, account }, order): AgyAccountEntry => {
            const title = params.agyAccountTitle(account);
            return {
                kind: 'agy',
                key: `agy:${machine.machineId}:${account.accountId}`,
                tab: 'agy',
                machine,
                account,
                title,
                health: 'healthy',
                searchText: searchTextOf([title, account.email, machine.machineName, params.agyServiceLabel]),
                order,
            };
        });
}

/**
 * Every account on the page: what needs attention first, then by service, then as listed, then by name.
 * Entries keep their identity, so a card whose account did not change need not draw again.
 */
export function orderAccountEntries(
    connected: readonly ConnectedAccountEntry[],
    agy: readonly AgyAccountEntry[],
): readonly AccountEntry[] {
    return [...connected, ...agy].sort((a, b) => (
        HEALTH_RANK[a.health] - HEALTH_RANK[b.health]
        || TAB_ORDER.indexOf(a.tab) - TAB_ORDER.indexOf(b.tab)
        || a.order - b.order
        || a.title.localeCompare(b.title)
    ));
}

export function countAccountsByTab(entries: readonly AccountEntry[]): Readonly<Record<AccountsTabId, number>> {
    const counts: Record<AccountsTabId, number> = { all: entries.length, codex: 0, claude: 0, agy: 0, other: 0 };
    for (const entry of entries) counts[entry.tab] += 1;
    return counts;
}

/** Codex and Claude can always take an account; the others appear once they hold one. */
export function resolveVisibleAccountTabs(counts: Readonly<Record<AccountsTabId, number>>): readonly AccountsTabId[] {
    return [
        'all',
        'codex',
        'claude',
        ...(counts.agy > 0 ? ['agy' as const] : []),
        ...(counts.other > 0 ? ['other' as const] : []),
    ];
}

export function filterAccountEntries(
    entries: readonly AccountEntry[],
    tab: AccountsTabId,
    query: string,
): readonly AccountEntry[] {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => (
        (tab === 'all' || entry.tab === tab) && (!needle || entry.searchText.includes(needle))
    ));
}

/** One card width for every row, so a short last row lines up with the rows above it. */
export function resolveAccountGridItemWidth(containerWidthPx: number): number {
    const columns = Math.min(
        GRID_MAX_COLUMNS,
        Math.max(1, Math.floor((containerWidthPx + ACCOUNT_GRID_GAP_PX) / (GRID_MIN_ITEM_WIDTH_PX + ACCOUNT_GRID_GAP_PX))),
    );
    return Math.max(0, Math.floor((containerWidthPx - ACCOUNT_GRID_GAP_PX * (columns - 1)) / columns));
}
