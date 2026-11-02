import { describe, expect, it } from 'vitest';

import { resolveSessionActionDefaultBackend } from './resolveSessionActionDefaultBackend';

describe('resolveSessionActionDefaultBackend', () => {
  it('falls back to the inferred built-in agent from the session flavor', () => {
    const resolved = resolveSessionActionDefaultBackend({
      session: {
        id: 's1',
        metadata: {
          flavor: 'codex',
        },
      } as any,
      enabledAgentIds: ['claude', 'codex'],
    });

    expect(resolved).toEqual({
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      defaultBackendId: 'codex',
    });
  });

  it('uses shared metadata inference for codex app-server sessions that only have a vendor session id', () => {
    const resolved = resolveSessionActionDefaultBackend({
      session: {
        id: 's1',
        metadata: {
          codexSessionId: 'thread-1',
          sessionModesV1: {
            v: 1,
            provider: 'codex',
            updatedAt: 10,
            currentModeId: 'default',
            availableModes: [],
          },
        },
      } as any,
      enabledAgentIds: ['claude', 'codex'],
    });

    expect(resolved).toEqual({
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
      defaultBackendId: 'codex',
    });
  });

  it('preserves raw metadata.agent for id-based review defaults while keeping a built-in target', () => {
    const resolved = resolveSessionActionDefaultBackend({
      session: {
        id: 's1',
        metadata: {
          flavor: 'claude',
          agent: 'coderabbit',
        },
      } as any,
      enabledAgentIds: ['claude', 'codex'],
    });

    expect(resolved).toEqual({
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      defaultBackendId: 'coderabbit',
    });
  });
});
