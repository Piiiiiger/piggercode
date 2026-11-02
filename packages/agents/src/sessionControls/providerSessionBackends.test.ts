import { describe, expect, it } from 'vitest';

import {
  applyAgentRuntimeKindOverrideToAccountSettings,
  normalizeAgentRuntimeKindOverride,
  resolveAgentConfiguredRuntimeKind,
  resolveAgentRuntimeControlSurfaceForSession,
  resolveCodexSessionBackendMode,
} from './providerSessionBackends.js';

describe('providerSessionBackends', () => {
  it('defaults the configured Codex backend mode to appServer when no override is present', () => {
    expect(resolveCodexSessionBackendMode({
      metadata: null,
      accountSettings: null,
    })).toBe('appServer');
  });

  it('ignores invalid runtime-kind overrides when applying to account settings', () => {
    expect(applyAgentRuntimeKindOverrideToAccountSettings({
      agentId: 'codex',
      accountSettings: { codexBackendMode: 'appServer' },
      runtimeKindOverride: 'server',
    })).toEqual({ codexBackendMode: 'appServer' });
  });

  it('derives the Codex runtime surface from account settings when no persisted runtime identity exists', () => {
    expect(resolveAgentRuntimeControlSurfaceForSession({
      agentId: 'codex',
      metadata: {},
      accountSettings: { codexBackendMode: 'mcp' },
    })).toMatchObject({
      sessionCapabilities: {
        sessionFork: { conversation: 'unsupported' },
        sessionRollback: { conversation: 'unsupported' },
      },
      localControl: null,
    });
  });
});
