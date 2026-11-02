import { describe, expect, it } from 'vitest';

import { resolveAgentToolsDelivery } from './resolveAgentToolsDelivery';

describe('resolveAgentToolsDelivery', () => {
  it('preserves the manifest delivery for providers without runtime shell prerequisites', () => {
    expect(resolveAgentToolsDelivery('claude', {
      platform: 'win32',
      environmentVariables: {},
    })).toBe('native_mcp');
  });
});
