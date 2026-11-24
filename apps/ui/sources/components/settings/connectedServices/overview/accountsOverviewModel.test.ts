import type { ConnectedServiceId } from '@piggercode/protocol';
import { describe, expect, it } from 'vitest';

import type { AgyMachineUsage } from '@/hooks/server/connectedServices/useAgyAccountUsage';

import {
    buildAgyAccountEntries,
    buildConnectedAccountEntries,
    countAccountsByTab,
    filterAccountEntries,
    orderAccountEntries,
    resolveAccountGridItemWidth,
    resolveVisibleAccountTabs,
} from './accountsOverviewModel';

const MACHINE: AgyMachineUsage = {
    machineId: 'vm',
    machineName: 'build box',
    platform: 'linux',
    status: 'ok',
    accounts: [
        { accountId: 'default', email: 'main@example.com', planTier: null, observedAtMs: 1, meters: [] },
        { accountId: 'b', email: null, planTier: null, observedAtMs: null, meters: [] },
    ],
};

function entries(services: ReadonlyArray<{
    serviceId: ConnectedServiceId;
    profiles: ReadonlyArray<{ profileId: string; status?: unknown; providerEmail?: unknown }>;
}>, agyMachines: readonly AgyMachineUsage[] = [], usageEnabled = true) {
    return orderAccountEntries(
        buildConnectedAccountEntries({
            services,
            labelsByKey: {},
            usageEnabled,
            serviceLabel: (serviceId) => `service ${serviceId}`,
        }),
        buildAgyAccountEntries({
            agyMachines,
            agyAccountTitle: (account) => account.email ?? `login ${account.accountId}`,
            agyServiceLabel: 'Gemini',
        }),
    );
}

describe('account entries', () => {
    it('lists every account under its agent, with what needs attention first', () => {
        const list = entries([
            { serviceId: 'github', profiles: [{ profileId: 'token', status: 'connected' }] },
            { serviceId: 'claude-subscription', profiles: [{ profileId: 'c', status: 'connected', providerEmail: 'c@example.com' }] },
            { serviceId: 'openai-codex', profiles: [
                { profileId: 'ok', status: 'connected', providerEmail: 'ok@example.com' },
                { profileId: 'expired', status: 'needs_reauth', providerEmail: 'expired@example.com' },
            ] },
            { serviceId: 'openai', profiles: [{ profileId: 'key', status: 'connected' }] },
        ], [MACHINE]);

        expect(list[0]).toMatchObject({ profileId: 'expired', tab: 'codex' });
        expect(list.map((entry) => entry.tab).slice(1)).toEqual(['codex', 'codex', 'claude', 'agy', 'agy', 'other']);
    });

    it('reads usage only for subscription logins, and for none while usage is off', () => {
        const services = [
            { serviceId: 'openai-codex' as const, profiles: [{ profileId: 'sub', status: 'connected' }] },
            { serviceId: 'openai' as const, profiles: [{ profileId: 'key', status: 'connected' }] },
        ];
        const showsUsage = (list: ReturnType<typeof entries>) => Object.fromEntries(
            list.flatMap((entry) => (entry.kind === 'connected' ? [[entry.profileId, entry.showsUsage]] : [])),
        );

        expect(showsUsage(entries(services))).toEqual({ sub: true, key: false });
        expect(showsUsage(entries(services, [], false))).toEqual({ sub: false, key: false });
    });

    it('leaves out a profile with no id', () => {
        expect(entries([{ serviceId: 'openai-codex', profiles: [{ profileId: '  ' }] }])).toEqual([]);
    });
});

describe('tabs and search', () => {
    const list = entries([
        { serviceId: 'openai-codex', profiles: [{ profileId: 'a', status: 'connected', providerEmail: 'work@example.com' }] },
    ], [MACHINE]);

    it('counts each tab and offers Gemini only once it holds an account', () => {
        const counts = countAccountsByTab(list);
        expect(counts).toEqual({ all: 3, codex: 1, claude: 0, agy: 2, other: 0 });
        expect(resolveVisibleAccountTabs(counts)).toEqual(['all', 'codex', 'claude', 'agy']);
        expect(resolveVisibleAccountTabs(countAccountsByTab([]))).toEqual(['all', 'codex', 'claude']);
    });

    it('filters by tab, and by account, email or machine in any case', () => {
        const titles = (tab: Parameters<typeof filterAccountEntries>[1], query: string) => (
            filterAccountEntries(list, tab, query).map((entry) => entry.title)
        );
        expect(titles('codex', '')).toEqual(['work@example.com']);
        expect(titles('all', '  WORK@ ')).toEqual(['work@example.com']);
        // agy's order: the real home's login first.
        expect(titles('all', 'build box')).toEqual(['main@example.com', 'login b']);
        expect(titles('codex', 'main@')).toEqual([]);
    });
});

describe('resolveAccountGridItemWidth', () => {
    it('fits up to three equal columns of at least 280 px, and one on a phone', () => {
        expect(resolveAccountGridItemWidth(358)).toBe(358);
        expect(resolveAccountGridItemWidth(600)).toBe(294);
        expect(resolveAccountGridItemWidth(1000)).toBe(325);
        expect(resolveAccountGridItemWidth(1600)).toBe(525);
    });
});
