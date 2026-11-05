import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/domains/state/storageTypes';

import { resolvePreferredMachineId } from './resolvePreferredMachineId';

function machine(id: string, agentsHosted?: boolean): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: Date.now(),
        metadata: {
            host: id,
            platform: 'linux',
            happyCliVersion: '0.3.4',
            happyHomeDir: '/h/.piggercode',
            homeDir: '/h',
            ...(agentsHosted === undefined ? {} : { agentsHosted }),
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 0,
        revokedAt: null,
    } as Machine;
}

describe('the machine a new session starts on by default', () => {
    it('is never a computer that does not run agents, even when it was preferred or used last', () => {
        const machines = [machine('mac', false), machine('server')];
        const lastUsedMac = [{ machineId: 'mac' }];

        expect(resolvePreferredMachineId({ machines, recentMachinePaths: lastUsedMac, preferredMachineId: 'mac' })).toBe('server');
        expect(resolvePreferredMachineId({ machines, recentMachinePaths: lastUsedMac, preferredMachineId: 'mac', onlineOnly: true }))
            .toBe('server');
        expect(resolvePreferredMachineId({ machines: [machine('mac', false)], recentMachinePaths: lastUsedMac, preferredMachineId: 'mac' }))
            .toBeNull();
    });
});
