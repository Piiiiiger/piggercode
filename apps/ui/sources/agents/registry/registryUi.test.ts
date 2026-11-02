import { describe, expect, it } from 'vitest';

import { AGENT_IDS as SHARED_AGENT_IDS } from '@piggercode/agents';

import { AGENTS_UI } from './registryUi';
import { getAgentPickerIconScale } from './registryUi';

function sortedKeys(value: Record<string, unknown>): string[] {
    return Object.keys(value).sort();
}

describe('agents/registryUi', () => {
    it('covers the full canonical provider universe (no UI-only drift)', () => {
        expect(sortedKeys(AGENTS_UI)).toEqual([...SHARED_AGENT_IDS].sort());
    });

    it('gives every registered agent a themed provider mark', () => {
        // A registered agent without a mark falls back to a generic Ionicon, which reads as an
        // unfinished integration everywhere the backend is offered. Agy shipped that way, and
        // nothing failed, because coverage was only ever asserted one provider at a time.
        const theme = {
            colors: {
                text: {
                    primary: '#111111',
                },
            },
        } as never;

        const withoutMark = [...SHARED_AGENT_IDS].filter((agentId) => {
            const xml = AGENTS_UI[agentId].svgIconXml?.(theme);
            return typeof xml !== 'string' || !xml.includes('<svg');
        });

        expect(withoutMark).toEqual([]);
    });

    it('slightly enlarges the Claude picker icon to compensate for the logo silhouette', () => {
        expect(getAgentPickerIconScale('claude')).toBe(1.1);
    });

});
