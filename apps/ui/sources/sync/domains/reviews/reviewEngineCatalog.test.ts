import { describe, expect, it } from 'vitest';

import { buildAvailableReviewEngineOptions } from './reviewEngineCatalog';

describe('buildAvailableReviewEngineOptions', () => {
  it('lists enabled agents and disables those the machine reports as unavailable', () => {
    const opts = buildAvailableReviewEngineOptions({
      enabledAgentIds: ['claude', 'codex'],
      resolveAgentLabel: (id) => `agent:${id}`,
      executionRunsBackends: {
        claude: { available: true, intents: ['review', 'plan'] },
        codex: { available: false, intents: ['review'] },
      },
    });

    expect(opts).toEqual([
      { id: 'claude', label: 'agent:claude' },
      { id: 'codex', label: 'agent:codex', disabled: true },
    ]);
  });

  it('lists enabled agents when no machine backend snapshot is available yet (best-effort)', () => {
    const opts = buildAvailableReviewEngineOptions({
      enabledAgentIds: ['claude'],
      resolveAgentLabel: (id) => `agent:${id}`,
      executionRunsBackends: null,
    });

    expect(opts).toEqual([{ id: 'claude', label: 'agent:claude' }]);
  });
});
