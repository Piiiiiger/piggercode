import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_ID } from './manifest.js';

import { resolveAgentIdFromFlavor } from './resolveAgentIdFromFlavor.js';
import { inferAgentIdFromSessionMetadata } from './resolveAgentIdFromSessionMetadata.js';

describe('resolveAgentIdFromFlavor', () => {

  it('returns null for unknown flavors', () => {
    expect(resolveAgentIdFromFlavor('unknown-provider')).toBeNull();
    expect(resolveAgentIdFromFlavor('')).toBeNull();
    expect(resolveAgentIdFromFlavor(null)).toBeNull();
  });
});

describe('inferAgentIdFromSessionMetadata', () => {
  it('prefers metadata.flavor when it resolves', () => {
    expect(inferAgentIdFromSessionMetadata({ flavor: 'gpt' })).toBe('codex');
  });

  it('falls back to DEFAULT_AGENT_ID when no inference matches', () => {
    expect(inferAgentIdFromSessionMetadata({})).toBe(DEFAULT_AGENT_ID);
    expect(inferAgentIdFromSessionMetadata(null)).toBe(DEFAULT_AGENT_ID);
  });
});
