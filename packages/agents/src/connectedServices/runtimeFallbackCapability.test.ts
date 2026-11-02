import { describe, expect, it } from 'vitest';

import { AGENTS_CORE } from '../manifest.js';
import {
    isConnectedServiceAccountGroupConfigurationSupported,
    isConnectedServiceRuntimeFallbackSupported,
    resolveConnectedServiceRuntimeFallbackCapability,
    supportsAgentConnectedServiceSessionAuthSwitchTransition,
} from './runtimeFallbackCapability.js';

describe('runtime fallback capability', () => {
    it('respects service-scoped transition support for individual agents', () => {
        expect(supportsAgentConnectedServiceSessionAuthSwitchTransition({
            agentCore: AGENTS_CORE.codex,
            serviceId: 'openai-codex',
            transition: 'connected_to_connected',
        })).toBe(true);

        expect(supportsAgentConnectedServiceSessionAuthSwitchTransition({
            agentCore: AGENTS_CORE.codex,
            serviceId: 'openai',
            transition: 'connected_to_connected',
        })).toBe(false);
    });

    it('keeps same-group runtime fallback support distinct from broader group configuration support', () => {
        const codex = resolveConnectedServiceRuntimeFallbackCapability('openai-codex');

        expect(codex.groupConfigurationSupported).toBe(true);
        expect(codex.runtimeFallbackSupported).toBe(true);
        expect(codex.quotaResetSupported).toBe(true);
        expect(resolveConnectedServiceRuntimeFallbackCapability('anthropic').quotaResetSupported).toBe(false);
        expect(resolveConnectedServiceRuntimeFallbackCapability('openai').quotaResetSupported).toBe(false);
        expect(codex.runtimeFallbackSupportingAgentIds).toContain('codex');
        expect(codex.groupConfigurationSupportingAgentIds).toContain('codex');
    });

    it('permits quota reset policy only for Claude subscription accounts', () => {
        const subscription = resolveConnectedServiceRuntimeFallbackCapability('claude-subscription');
        expect(subscription.quotaResetSupported).toBe(true);
        expect(subscription.runtimeFallbackSupportingAgentIds).toEqual(['claude']);
        expect(resolveConnectedServiceRuntimeFallbackCapability('anthropic').quotaResetSupported).toBe(false);
    });

    it('fails closed for services with no runtime fallback implementation', () => {
        expect(isConnectedServiceRuntimeFallbackSupported('github')).toBe(false);
    });
});
