import { afterEach, describe, it, expect } from 'vitest';
import Constants from 'expo-constants';
import { buildBackendTargetKey } from '@piggercode/protocol';

import { getEnabledAgentIds, isAgentEnabled, isAgentOffered } from './enabled';
import { AGENT_IDS } from './catalog';

function setBuildAgentIds(agentIds: unknown): void {
    (Constants.expoConfig!.extra as Record<string, unknown>).app = { agentIds };
}

describe('agents/enabled', () => {
    it('enables all agents by default when no explicit backend map is provided', () => {
        for (const agentId of AGENT_IDS) {
            expect(isAgentEnabled({ agentId, backendEnabledByTargetKey: {} })).toBe(true);
            expect(isAgentEnabled({ agentId, backendEnabledByTargetKey: null })).toBe(true);
            expect(isAgentEnabled({ agentId, backendEnabledByTargetKey: undefined })).toBe(true);
        }
    });

    it('returns enabled agent ids in display order', () => {
        expect(getEnabledAgentIds({ backendEnabledByTargetKey: {} })).toEqual(['claude', 'codex']);
        expect(getEnabledAgentIds({
            backendEnabledByTargetKey: {
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: false,
            },
        })).toEqual(['claude']);
    });

    it('ignores unknown backend ids in the toggle map', () => {
        expect(getEnabledAgentIds({ backendEnabledByTargetKey: { unknownAgent: false } })).toEqual(['claude', 'codex']);
    });

    describe('agents the build offers', () => {
        afterEach(() => {
            delete (Constants.expoConfig!.extra as Record<string, unknown>).app;
        });

        it('offers only the agents the build names, in catalog order', () => {
            setBuildAgentIds(['claude', 'notAnAgent']);

            expect(isAgentOffered('claude')).toBe(true);
            expect(isAgentOffered('codex')).toBe(false);
            expect(isAgentEnabled({ agentId: 'codex', backendEnabledByTargetKey: {} })).toBe(false);
            expect(getEnabledAgentIds({ backendEnabledByTargetKey: {} })).toEqual(['claude']);
        });

        it('still lets the user switch an offered agent off', () => {
            setBuildAgentIds(['claude', 'codex']);

            expect(getEnabledAgentIds({
                backendEnabledByTargetKey: { [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: false },
            })).toEqual(['claude']);
        });

        it('offers every agent when the build names no known agent', () => {
            setBuildAgentIds(['notAnAgent']);

            expect(isAgentOffered('codex')).toBe(true);
            expect(getEnabledAgentIds({ backendEnabledByTargetKey: {} })).toEqual([...AGENT_IDS]);
        });
    });
});
