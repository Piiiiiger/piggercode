import { describe, expect, it } from 'vitest';

import { createMachineFixture } from '@/dev/testkit';

import {
    evaluateManagingMachineChange,
    hasEnrolledSubscriptionProfiles,
    listMachinesWithoutManagementSupport,
} from './connectedServicesManagementRules';

const current = (version: string | undefined, overrides: Parameters<typeof createMachineFixture>[0] = {}) => createMachineFixture({
    metadata: { host: 'h', platform: 'linux', happyCliVersion: version as string, happyHomeDir: '/h', homeDir: '/h' },
    ...overrides,
});

const noProfiles = [{ serviceId: 'openai-codex' as const, profiles: [] }];
const withCodexProfile = [{ serviceId: 'openai-codex' as const, profiles: [{ profileId: 'work' }] }];

describe('listMachinesWithoutManagementSupport', () => {
    it('flags old and version-less machines but ignores revoked and replaced ones', () => {
        const machines = [
            current('0.3.42', { id: 'ok' }),
            current('0.3.41', { id: 'old' }),
            current(undefined, { id: 'unknown' }),
            current('0.3.1', { id: 'revoked', revokedAt: 5 }),
            current('0.3.1', { id: 'replaced', replacedByMachineId: 'ok' }),
        ];
        expect(listMachinesWithoutManagementSupport(machines).map((machine) => machine.id)).toEqual(['old', 'unknown']);
    });
});

describe('hasEnrolledSubscriptionProfiles', () => {
    it('counts only subscription-login services with profiles', () => {
        expect(hasEnrolledSubscriptionProfiles(withCodexProfile)).toBe(true);
        expect(hasEnrolledSubscriptionProfiles(noProfiles)).toBe(false);
        expect(hasEnrolledSubscriptionProfiles([{ serviceId: 'anthropic', profiles: [{ profileId: 'k' }] } as never])).toBe(false);
    });
});

describe('evaluateManagingMachineChange', () => {
    const machines = [current('0.3.42', { id: 'a' }), current('0.3.43', { id: 'b' })];

    it('allows choosing a machine while none is set, even with enrolled profiles', () => {
        expect(evaluateManagingMachineChange({
            currentMachineId: null, nextMachineId: 'a', machines, connectedServicesV2: withCodexProfile,
        })).toEqual({ ok: true });
    });

    it('refuses to change or clear the machine while subscription profiles are enrolled', () => {
        for (const nextMachineId of ['b', null]) {
            expect(evaluateManagingMachineChange({
                currentMachineId: 'a', nextMachineId, machines, connectedServicesV2: withCodexProfile,
            })).toEqual({ ok: false, reason: 'enrolled_profiles' });
        }
    });

    it('allows a change once nothing is enrolled', () => {
        expect(evaluateManagingMachineChange({
            currentMachineId: 'a', nextMachineId: 'b', machines, connectedServicesV2: noProfiles,
        })).toEqual({ ok: true });
    });

    it('refuses a choice and names every incompatible machine', () => {
        const mixed = [...machines, current('0.3.40', { id: 'c', metadata: { host: 'old-box', platform: 'linux', happyCliVersion: '0.3.40', happyHomeDir: '/h', homeDir: '/h' } })];
        expect(evaluateManagingMachineChange({
            currentMachineId: null, nextMachineId: 'a', machines: mixed, connectedServicesV2: noProfiles,
        })).toEqual({ ok: false, reason: 'incompatible_machines', machineNames: ['old-box'] });
    });

    it('does not require compatibility to clear the machine', () => {
        expect(evaluateManagingMachineChange({
            currentMachineId: 'a', nextMachineId: null, machines: [current('0.1.0', { id: 'x' })], connectedServicesV2: noProfiles,
        })).toEqual({ ok: true });
    });
});
