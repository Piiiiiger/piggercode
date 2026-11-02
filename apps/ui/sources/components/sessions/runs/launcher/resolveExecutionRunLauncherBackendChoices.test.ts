import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => `t:${key}`,
    });
});

import { resolveExecutionRunLauncherBackendChoices } from './resolveExecutionRunLauncherBackendChoices';

describe('resolveExecutionRunLauncherBackendChoices', () => {
    it('titles built-in run backends with the localized catalog name rather than the raw agent id', () => {
        const choices = resolveExecutionRunLauncherBackendChoices({
            enabledAgentIds: ['claude'],
            executionRunsBackends: {
                claude: { available: true, intents: ['run'] },
                codex: { available: true, intents: ['run'] },
            },
            intent: 'run',
        });

        expect(choices.map((choice) => choice.title)).toEqual([
            't:agentInput.agent.claude',
            't:agentInput.agent.codex',
        ]);
    });
});
