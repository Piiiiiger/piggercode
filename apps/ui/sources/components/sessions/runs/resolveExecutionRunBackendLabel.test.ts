import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => `t:${key}`,
    });
});

import { resolveExecutionRunBackendLabel } from './resolveExecutionRunBackendLabel';

describe('resolveExecutionRunBackendLabel', () => {
    it('labels a built-in run backend with the localized catalog name rather than the raw agent id', () => {
        expect(resolveExecutionRunBackendLabel({ kind: 'builtInAgent', agentId: 'claude' }))
            .toBe('t:agentInput.agent.claude');
        expect(resolveExecutionRunBackendLabel({ kind: 'builtInAgent', agentId: 'codex' }))
            .toBe('t:agentInput.agent.codex');
    });

    it('falls back to the raw id for a backend the agent catalog does not own', () => {
        expect(resolveExecutionRunBackendLabel({ kind: 'builtInAgent', agentId: 'native-review-engine' }))
            .toBe('native-review-engine');
    });

    it('returns null when there is no backend target', () => {
        expect(resolveExecutionRunBackendLabel(null)).toBeNull();
        expect(resolveExecutionRunBackendLabel(undefined)).toBeNull();
    });
});
