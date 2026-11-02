import { describe, expect, it } from 'vitest';

import { resolveReviewOutputNormalizer } from './reviewEngineRegistry';

describe('reviewEngineRegistry', () => {
  it('provides a review output normalizer for Codex agent reviews', () => {
    expect(resolveReviewOutputNormalizer('codex')).toBeTruthy();
  });

  it('has no normalizer for engines that are not agents', () => {
    expect(resolveReviewOutputNormalizer('unknown-engine')).toBeNull();
  });
});
