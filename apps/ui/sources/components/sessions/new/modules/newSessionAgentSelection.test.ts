import { describe, expect, it } from 'vitest';

import {
    getSelectableBackendEntriesForNewSession,
    getSelectableAgentIdsForNewSession,
    isBackendEntrySelectableForNewSession,
    isAgentSelectableForNewSession,
    resolveNextSelectableBackendEntryForNewSession,
    resolveNextSelectableAgentForNewSession,
    resolveProfileAvailabilityForNewSession,
} from './newSessionAgentSelection';

describe('newSessionAgentSelection', () => {
    it('treats all agents as selectable before detection completes', () => {
        expect(isAgentSelectableForNewSession({
            agentId: 'codex',
            detectionTimestamp: 0,
            availabilityById: { codex: false },
            installableDepKeyCountByAgentId: { codex: 0 },
        })).toBe(true);
    });

    it('keeps unavailable agents selectable when they have installable dependencies', () => {
        expect(isAgentSelectableForNewSession({
            agentId: 'codex',
            detectionTimestamp: 1,
            availabilityById: { codex: false },
            installableDepKeyCountByAgentId: { codex: 1 },
        })).toBe(true);
    });

    it('treats logged-out agents as unavailable even when the CLI is installed', () => {
        expect(isAgentSelectableForNewSession({
            agentId: 'codex',
            detectionTimestamp: 1,
            availabilityById: { codex: true },
            authStatusById: {
                codex: {
                    state: 'logged_out',
                    checkedAt: 123,
                },
            },
            installableDepKeyCountByAgentId: { codex: 0 },
        })).toBe(false);
    });

    it('treats missing availability as unavailable after detection completes unless another path keeps it selectable', () => {
        expect(isAgentSelectableForNewSession({
            agentId: 'codex',
            detectionTimestamp: 1,
            availabilityById: {},
            installableDepKeyCountByAgentId: { codex: 0 },
        })).toBe(false);
    });

    it('resolves the next selectable agent while skipping unavailable intermediates', () => {
        expect(resolveNextSelectableAgentForNewSession({
            candidateAgentIds: ['claude', 'codex'],
            currentAgentId: 'claude',
            detectionTimestamp: 1,
            availabilityById: { claude: true, codex: true },
            installableDepKeyCountByAgentId: { codex: 0 },
        })).toBe('codex');
    });

    it('builds the selectable list from candidates using the same policy as chip cycling', () => {
        expect(getSelectableAgentIdsForNewSession({
            candidateAgentIds: ['claude', 'codex'],
            detectionTimestamp: 1,
            availabilityById: { claude: true, codex: false },
            installableDepKeyCountByAgentId: { codex: 0 },
        })).toEqual(['claude']);
    });

    it('marks multi-cli profiles as available when at least one supported agent remains selectable', () => {
        expect(resolveProfileAvailabilityForNewSession({
            candidateBackendEntries: [
                { target: { kind: 'builtInAgent', agentId: 'claude' }, targetKey: 'agent:claude', builtInAgentId: 'claude', family: 'builtInAgent' },
                { target: { kind: 'builtInAgent', agentId: 'codex' }, targetKey: 'agent:codex', builtInAgentId: 'codex', family: 'builtInAgent' },
            ],
            detectionTimestamp: 1,
            availabilityById: { claude: false, codex: false },
            installableDepKeyCountByAgentId: { codex: 1 },
        })).toEqual({ available: true });
    });

    it('marks multi-cli profiles unavailable with a logged-out reason when every installed agent is logged out', () => {
        expect(resolveProfileAvailabilityForNewSession({
            candidateBackendEntries: [
                { target: { kind: 'builtInAgent', agentId: 'claude' }, targetKey: 'agent:claude', builtInAgentId: 'claude', family: 'builtInAgent' },
                { target: { kind: 'builtInAgent', agentId: 'codex' }, targetKey: 'agent:codex', builtInAgentId: 'codex', family: 'builtInAgent' },
            ],
            detectionTimestamp: 1,
            availabilityById: { claude: true, codex: true },
            authStatusById: {
                claude: { state: 'logged_out', checkedAt: 1 },
                codex: { state: 'logged_out', checkedAt: 1 },
            },
            installableDepKeyCountByAgentId: {},
        })).toEqual({ available: false, reason: 'logged-out:any' });
    });

});
