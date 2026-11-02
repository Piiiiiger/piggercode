import { describe, expect, it } from 'vitest';

import {
  BackendTargetRefSchema,
  buildBackendTargetKey,
  matchesBackendTargetAgentId,
  parseBackendTargetKey,
} from './backendTargetRef.js';

describe('backend target refs', () => {
  it('round-trips a built-in agent target through its key', () => {
    const target = { kind: 'builtInAgent', agentId: 'codex' } as const;
    const key = buildBackendTargetKey(target);
    expect(key).toBe('agent:codex');
    expect(parseBackendTargetKey(key)).toEqual(target);
    expect(matchesBackendTargetAgentId(target, 'codex')).toBe(true);
    expect(matchesBackendTargetAgentId(target, 'claude')).toBe(false);
  });

  it('accepts only built-in agent targets and agent keys', () => {
    expect(BackendTargetRefSchema.safeParse({ kind: 'configuredAcpBackend', backendId: 'custom' }).success).toBe(false);
    expect(() => parseBackendTargetKey('acpBackend:custom')).toThrow();
  });
});
