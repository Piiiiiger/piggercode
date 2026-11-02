import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ResolvedBackendCatalogEntry } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';

import { buildSessionAgentPickerOptions } from './buildSessionAgentPickerOptions';

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

vi.mock('@/agents/registry/registryUi', () => ({
    getAgentPickerIconScale: () => 1,
}));

function entry(
    agentId: string,
    overrides: Partial<ResolvedBackendCatalogEntry> = {},
): ResolvedBackendCatalogEntry {
    return {
        target: { kind: 'builtInAgent', agentId } as ResolvedBackendCatalogEntry['target'],
        targetKey: `builtInAgent:${agentId}`,
        family: 'builtInAgent',
        providerAgentId: agentId as ResolvedBackendCatalogEntry['providerAgentId'],
        builtInAgentId: agentId as ResolvedBackendCatalogEntry['builtInAgentId'],
        iconAgentId: agentId as ResolvedBackendCatalogEntry['iconAgentId'],
        title: agentId,
        subtitle: null,
        ...overrides,
    };
}

const availablePresentation = { disabled: false, muted: false } as const;

describe('buildSessionAgentPickerOptions', () => {
    it('leads with favorites, then applicable rows, then blocked rows', () => {
        const options = buildSessionAgentPickerOptions({
            entries: [entry('claude'), entry('codex')],
            favoriteBackendTargetKeys: ['builtInAgent:codex'],
            leadingOptions: [{ id: 'favorite-models', label: 'Favorites' }],
            resolvePresentation: (candidate) => {
                if (candidate.providerAgentId === 'claude') {
                    return { subtitle: 'CLI not detected', disabled: true, muted: true };
                }
                return availablePresentation;
            },
            resolveBehavior: () => ({}),
        });

        expect(options.map((option) => option.id)).toEqual([
            'favorite-models',
            'builtInAgent:codex',
            'builtInAgent:claude',
        ]);
    });

    it('carries the caller-owned explanation, availability, and behavior onto each row', () => {
        const onSelectImmediate = vi.fn();
        const options = buildSessionAgentPickerOptions({
            entries: [entry('codex'), entry('claude')],
            resolvePresentation: (candidate) => (candidate.providerAgentId === 'claude'
                ? { subtitle: 'Update the CLI', disabled: true, muted: true }
                : availablePresentation),
            resolveBehavior: ({ presentation, entry: candidate }) => (presentation.disabled
                ? { detailTitle: candidate.title, detailDescription: presentation.subtitle }
                : { closeOnSelectImmediate: false, onSelectImmediate }),
        });

        const [codexOption, claudeOption] = options;
        expect(codexOption).toMatchObject({
            id: 'builtInAgent:codex',
            label: 'codex',
            disabled: false,
            muted: false,
            closeOnSelectImmediate: false,
        });
        expect(claudeOption).toMatchObject({
            id: 'builtInAgent:claude',
            disabled: true,
            muted: true,
            subtitle: 'Update the CLI',
            detailDescription: 'Update the CLI',
        });
        expect(claudeOption?.onSelectImmediate).toBeUndefined();

        codexOption?.onSelectImmediate?.();
        expect(onSelectImmediate).toHaveBeenCalledTimes(1);
    });

    it('reports whether a row is a favorite so callers can render its rail action', () => {
        const railActionContexts: Array<Readonly<{ id: string; favorite: boolean }>> = [];
        buildSessionAgentPickerOptions({
            entries: [entry('claude'), entry('codex')],
            favoriteBackendTargetKeys: ['builtInAgent:codex'],
            resolvePresentation: () => availablePresentation,
            resolveRailAction: ({ entry: candidate, favorite }) => {
                railActionContexts.push({ id: candidate.targetKey, favorite });
                return undefined;
            },
            resolveBehavior: () => ({}),
        });

        expect(railActionContexts).toEqual([
            { id: 'builtInAgent:codex', favorite: true },
            { id: 'builtInAgent:claude', favorite: false },
        ]);
    });

});
