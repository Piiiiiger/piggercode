import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_ID } from '@/agents/catalog/catalog';

import { getPreferredMcpPreviewAgentId, listDetectedMcpProviderIds, listMcpPreviewAgentIds } from './mcpServerScreenHelpers';

describe('mcpServerScreenHelpers', () => {
    it('lists detected MCP providers from the protocol contract without screen-local hardcoding', () => {
        expect(listDetectedMcpProviderIds()).toEqual(['claude', 'codex']);
    });

    it('lists preview-capable MCP agents from the agent registry without screen-local hardcoding', () => {
        expect(listMcpPreviewAgentIds()).toEqual(
            expect.arrayContaining(['claude', 'codex']),
        );
    });

    it('prefers the current preview agent when still available and otherwise falls back to the first supported agent', () => {
        expect(getPreferredMcpPreviewAgentId(['codex', 'claude'], 'claude')).toBe('claude');
        expect(getPreferredMcpPreviewAgentId(['codex'], 'claude')).toBe('codex');
        expect(getPreferredMcpPreviewAgentId([], 'claude')).toBe(DEFAULT_AGENT_ID);
    });
});
