import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => `t:${key}`,
    });
});

import { getResolvedBackendCatalogEntries } from './getResolvedBackendCatalogEntries';

describe('getResolvedBackendCatalogEntries', () => {
    it('returns one built-in entry per enabled agent', () => {
        const entries = getResolvedBackendCatalogEntries({
            enabledAgentIds: ['claude', 'codex'],
        });

        expect(entries).toEqual([
            expect.objectContaining({
                target: { kind: 'builtInAgent', agentId: 'claude' },
                targetKey: 'agent:claude',
                family: 'builtInAgent',
                providerAgentId: 'claude',
                iconAgentId: 'claude',
                title: 't:agentInput.agent.claude',
            }),
            expect.objectContaining({
                target: { kind: 'builtInAgent', agentId: 'codex' },
                targetKey: 'agent:codex',
                family: 'builtInAgent',
                providerAgentId: 'codex',
                iconAgentId: 'codex',
                title: 't:agentInput.agent.codex',
            }),
        ]);
    });
});
