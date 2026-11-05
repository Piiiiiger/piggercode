import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/domains/state/storageTypes';

import { buildMachineSelectionBuckets } from './buildMachineSelectionBuckets';

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

describe('machines offered for a new session', () => {
    it('never offers a computer that does not run agents, not even as a recent or favorite machine', () => {
        const server = machine('server');
        const mac = machine('mac', false);

        const buckets = buildMachineSelectionBuckets({ machines: [server, mac], recentMachines: [mac], favoriteMachines: [mac] });

        const offered = [
            ...buckets.visibleMachines,
            ...buckets.recentMachinesWithoutFavorites,
            ...buckets.favoriteMachines,
            ...buckets.allMachines,
        ].map((entry) => entry.id);
        expect(new Set(offered)).toEqual(new Set(['server']));
    });
});
