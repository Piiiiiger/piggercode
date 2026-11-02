import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import { getModelOptionsForAgentTypeOrPreflight } from './modelOptions';

describe('modelOptions preflight', () => {
    it('keeps a successful empty discovery authoritative while missing discovery uses the static fallback', () => {
        expect(getModelOptionsForAgentTypeOrPreflight({
            agentType: 'claude', preflight: { availableModels: [], supportsFreeform: true },
        }).map((row) => row.value)).toEqual(['default']);
        expect(getModelOptionsForAgentTypeOrPreflight({ agentType: 'claude', preflight: null }).length).toBeGreaterThan(1);
    });

    it('enriches advertised preflight models without adding missing catalog members', () => {
        const out = getModelOptionsForAgentTypeOrPreflight({
            agentType: 'claude',
            preflight: {
                availableModels: [
                    { id: 'claude-fable-5', name: 'Claude Fable 5' },
                    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
                    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
                    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
                    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
                    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
                ],
                supportsFreeform: true,
            },
        });

        const modelIds = out.map((option) => option.value);
        expect(modelIds).toEqual([
            'default',
            'claude-fable-5',
            'claude-opus-4-8',
            'claude-opus-4-7',
            'claude-opus-4-6',
            'claude-sonnet-4-6',
            'claude-haiku-4-5',
        ]);

        // Dynamic capability omissions remain authoritative; the catalog only enriches copy.
        expect(out.find((option) => option.value === 'claude-fable-5')?.modelOptions).toBeUndefined();
        expect(out.find((option) => option.value === 'claude-sonnet-4-6')?.extendedContextModelId).toBeUndefined();
        expect(out.find((option) => option.value === 'claude-opus-4-6')?.description).toBeTruthy();
    });

    it('names the model id on rows a duplicate label would otherwise make indistinguishable', () => {
        const out = getModelOptionsForAgentTypeOrPreflight({
            agentType: 'claude',
            preflight: {
                availableModels: [
                    { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5' },
                    { id: 'claude-opus-4-5', name: 'Opus 4.5' },
                    { id: 'claude-opus-4-6', name: 'Opus 4.6' },
                ],
                supportsFreeform: true,
            },
        });

        const pinned = out.find((option) => option.value === 'claude-opus-4-5-20251101');
        const alias = out.find((option) => option.value === 'claude-opus-4-5');
        // The pinned snapshot and its floating alias are both offered and both read "Opus 4.5",
        // so the row has to say which model id it actually selects.
        expect(pinned?.label).toBe('Opus 4.5');
        expect(alias?.label).toBe('Opus 4.5');
        expect(pinned?.description).toBe('claude-opus-4-5-20251101');
        expect(alias?.description).toBe('claude-opus-4-5');

        // A row nothing collides with keeps its curated blurb.
        const uncontested = out.find((option) => option.value === 'claude-opus-4-6');
        expect(uncontested?.description).not.toBe('claude-opus-4-6');
        expect(String(uncontested?.description).length).toBeGreaterThan(0);
    });
});
