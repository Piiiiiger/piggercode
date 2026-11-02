import { describe, expect, it } from 'vitest';

import { isSkippableProviderUnavailabilityError } from '../../src/testkit/providers/harness';

describe('providers harness: provider availability classification', () => {
  it('treats missing binary failures as skippable provider unavailability', () => {
    expect(isSkippableProviderUnavailabilityError('Missing required binary for provider codex: codex')).toBe(true);
  });

  it('does not classify regular scenario assertion failures as provider unavailability', () => {
    expect(isSkippableProviderUnavailabilityError('Missing required fixture key: acp/codex/tool-call/Read')).toBe(false);
    expect(isSkippableProviderUnavailabilityError('Scenario exceeded maxTraceEvents')).toBe(false);
  });
});
