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

    it('disables agents only when explicitly set to false', () => {
        const cases = [
            {
                agentId: 'gemini' as const,
                backendEnabledByTargetKey: { [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'gemini' })]: false } as Record<string, boolean>,
                expected: false,
            },
            {
                agentId: 'gemini' as const,
                backendEnabledByTargetKey: { [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'gemini' })]: true } as Record<string, boolean>,
                expected: true,
            },
            {
                agentId: 'auggie' as const,
                backendEnabledByTargetKey: { [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'auggie' })]: false } as Record<string, boolean>,
                expected: false,
            },
            {
                agentId: 'auggie' as const,
                backendEnabledByTargetKey: { [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'auggie' })]: true } as Record<string, boolean>,
                expected: true,
            },
        ];
        for (const testCase of cases) {
            expect(
                isAgentEnabled({
                    agentId: testCase.agentId,
                    backendEnabledByTargetKey: testCase.backendEnabledByTargetKey,
                }),
            ).toBe(testCase.expected);
        }
    });

    it('returns enabled agent ids in display order', () => {
        expect(getEnabledAgentIds({ backendEnabledByTargetKey: {} })).toEqual(['claude', 'codex', 'opencode', 'gemini', 'auggie', 'qwen', 'kimi', 'kilo', 'kiro', 'devin', 'customAcp', 'pi', 'copilot', 'cursor', 'grok', 'fx', 'droid', 'codebuddy', 'agy']);
        expect(getEnabledAgentIds({
            backendEnabledByTargetKey: {
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'gemini' })]: false,
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'auggie' })]: false,
            },
        })).toEqual(['claude', 'codex', 'opencode', 'qwen', 'kimi', 'kilo', 'kiro', 'devin', 'customAcp', 'pi', 'copilot', 'cursor', 'grok', 'fx', 'droid', 'codebuddy', 'agy']);
    });

    it('ignores unknown backend ids in the toggle map', () => {
        expect(getEnabledAgentIds({ backendEnabledByTargetKey: { unknownAgent: false } })).toEqual(['claude', 'codex', 'opencode', 'gemini', 'auggie', 'qwen', 'kimi', 'kilo', 'kiro', 'devin', 'customAcp', 'pi', 'copilot', 'cursor', 'grok', 'fx', 'droid', 'codebuddy', 'agy']);
    });

    describe('agents the build offers', () => {
        afterEach(() => {
            delete (Constants.expoConfig!.extra as Record<string, unknown>).app;
        });

        it('offers only the agents the build names, in catalog order', () => {
            setBuildAgentIds(['codex', 'claude', 'notAnAgent']);

            expect(isAgentOffered('claude')).toBe(true);
            expect(isAgentOffered('gemini')).toBe(false);
            expect(isAgentEnabled({ agentId: 'gemini', backendEnabledByTargetKey: {} })).toBe(false);
            expect(getEnabledAgentIds({ backendEnabledByTargetKey: {} })).toEqual(['claude', 'codex']);
        });

        it('still lets the user switch an offered agent off', () => {
            setBuildAgentIds(['claude', 'codex']);

            expect(getEnabledAgentIds({
                backendEnabledByTargetKey: { [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: false },
            })).toEqual(['claude']);
        });

        it('offers every agent when the build names no known agent', () => {
            setBuildAgentIds(['notAnAgent']);

            expect(isAgentOffered('gemini')).toBe(true);
            expect(getEnabledAgentIds({ backendEnabledByTargetKey: {} })).toEqual([...AGENT_IDS]);
        });
    });
});
