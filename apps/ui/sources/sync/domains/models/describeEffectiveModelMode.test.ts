import { describe, expect, it } from 'vitest';

import { describeEffectiveModelMode } from './describeEffectiveModelMode';
import { getAgentCore } from '@/agents/catalog/catalog';
import type { Metadata } from '@/sync/domains/state/storageTypes';

function buildMetadata(overrides: Partial<Metadata> = {}): Metadata {
    return {
        path: '/tmp',
        host: 'h',
        ...overrides,
    };
}

describe('describeEffectiveModelMode', () => {
    it('treats Claude model overrides as next-prompt', () => {
        const out = describeEffectiveModelMode({
            agentType: 'claude',
            selectedModelId: 'claude-3.5-sonnet',
            metadata: null,
        });
        expect(out.applyScope).toBe('next_prompt');
        expect(out.effectiveModelId).toBe('claude-3.5-sonnet');
        // When a change takes effect is `applyScope`, not prose: a surface renders
        // that as one line, so the policy owner no longer ships a timing sentence
        // for a picker to print as a paragraph.
        expect(out.notes.some((note) => /next message/i.test(note))).toBe(false);
    });

    it('treats Codex MCP model overrides as spawn-only when ACP metadata is absent', () => {
        const out = describeEffectiveModelMode({ agentType: 'codex', selectedModelId: 'gpt-5-codex-high', metadata: null });
        expect(out.applyScope).toBe('spawn_only');
    });

    it('treats Codex session-control model overrides as live when generic metadata is present', () => {
        const out = describeEffectiveModelMode({
            agentType: 'codex',
            selectedModelId: 'gpt-5-codex-high',
            metadata: buildMetadata({
                sessionModesV1: { v: 1, provider: 'codex', updatedAt: 1, currentModeId: 'ask', availableModes: [] },
            }),
        });
        expect(out.applyScope).toBe('live');
    });

    it('uses the provider default model when no model is selected and does not mark it as custom', () => {
        const out = describeEffectiveModelMode({
            agentType: 'codex',
            selectedModelId: '',
            metadata: null,
        });

        expect(out.effectiveModelId).toBe(getAgentCore('codex').model.defaultMode);
        expect(out.notes.join(' ')).not.toMatch(/custom model ids|not validated/i);
    });

    it('only shows the custom model note for explicit unknown model ids', () => {
        const known = describeEffectiveModelMode({
            agentType: 'claude',
            selectedModelId: 'claude-sonnet-4-5',
            metadata: null,
        });
        const custom = describeEffectiveModelMode({
            agentType: 'claude',
            selectedModelId: 'claude-custom-unlisted-model',
            metadata: null,
        });

        expect(known.notes.join(' ')).not.toMatch(/custom model ids|not validated/i);
        expect(custom.notes.join(' ')).toMatch(/custom model ids|not validated/i);
    });

    it('treats ACP metadata presence as live even when provider payload is malformed', () => {
        const out = describeEffectiveModelMode({
            agentType: 'codex',
            selectedModelId: 'gpt-5-codex',
            metadata: buildMetadata({
                acpSessionModelsV1: {
                    v: 1,
                    provider: 'unexpected-provider',
                    updatedAt: 1,
                    currentModelId: 'gpt-5-codex',
                    availableModels: [],
                } as Metadata['acpSessionModelsV1'],
            }),
        });

        expect(out.applyScope).toBe('live');
    });

    it('falls back to legacy ACP metadata keys when generic session-control keys are absent', () => {
        const out = describeEffectiveModelMode({
            agentType: 'codex',
            selectedModelId: 'gpt-5-codex',
            metadata: buildMetadata({
                acpSessionModesV1: { v: 1, provider: 'codex', updatedAt: 1, currentModeId: 'ask', availableModes: [] },
            }),
        });

        expect(out.applyScope).toBe('live');
    });

    it('falls back to provider default model when selected model is whitespace', () => {
        const out = describeEffectiveModelMode({
            agentType: 'codex',
            selectedModelId: '   ',
            metadata: null,
        });

        expect(out.effectiveModelId).toBe(getAgentCore('codex').model.defaultMode);
        expect(out.notes.join(' ')).not.toMatch(/custom model ids|not validated/i);
    });

    it('does not expose another provider applied model as the current model', () => {
        const out = describeEffectiveModelMode({
            agentType: 'codex',
            selectedModelId: 'gpt-5.6-sol',
            metadata: buildMetadata({
                sessionModelsV1: {
                    v: 1,
                    provider: 'claude',
                    updatedAt: 5,
                    currentModelId: 'claude-build',
                    availableModels: [{ id: 'claude-build', name: 'Claude Build' }],
                },
                sessionAppliedModelV1: {
                    v: 1,
                    provider: 'claude',
                    updatedAt: 6,
                    modelId: 'claude-build',
                },
            }),
        });

        expect(out.selectedModelId).toBe('gpt-5.6-sol');
        expect(out.appliedModelId).toBeNull();
    });
});
