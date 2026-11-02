import { describe, expect, it } from 'vitest';

import { ReviewStartInputSchema } from './reviewStart.js';

describe('ReviewStartInputSchema', () => {
  it('defaults review scope to uncommitted changes', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['claude'],
      instructions: 'Review.',
      base: { kind: 'none' },
    });

    expect(parsed.changeType).toBe('uncommitted');
  });

  it('defaults missing review instructions to an execution-run review', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['codex'],
      base: { kind: 'none' },
    });

    expect(parsed.instructions).toBe('');
    expect(parsed.runLocation).toBe('execution_run');
  });

  it('accepts current-session review location with blank instructions', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['codex'],
      instructions: '   ',
      runLocation: 'current_session',
      base: { kind: 'none' },
    });

    expect(parsed.instructions).toBe('');
    expect(parsed.runLocation).toBe('current_session');
  });
});
