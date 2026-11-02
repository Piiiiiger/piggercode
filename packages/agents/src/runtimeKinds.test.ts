import { describe, expect, it } from 'vitest';

import {
  getAgentRuntimeKindsManifest,
  resolveAgentRuntimeControlSurface,
  resolveDefaultAgentRuntimeKind,
} from './runtimeKinds.js';

describe('runtimeKinds', () => {

  it('resolves effective Codex runtime capabilities by deep-merging the base agent entry and runtime-kind overrides', () => {
    expect(resolveAgentRuntimeControlSurface('codex', 'appServer')).toMatchObject({
      resume: { vendorResume: 'experimental' },
      sessionCapabilities: {
        sessionFork: { conversation: 'supported', fromMessage: 'unsupported' },
        sessionRollback: { conversation: 'supported' },
        usageLimitRecovery: { checkNow: 'supported' },
      },
      media: { emitsSessionMedia: 'supported', nativeImageGeneration: 'supported' },
      handoff: { vendorStateTransfer: 'experimental', requiresExplicitSessionId: true },
      localControl: {
        supported: true,
        topology: 'shared',
        attachStrategy: 'provider_attach',
      },
    });

    expect(resolveAgentRuntimeControlSurface('codex', 'mcp')).toMatchObject({
      resume: { vendorResume: 'unsupported' },
      sessionCapabilities: {
        sessionFork: { conversation: 'unsupported', fromMessage: 'unsupported' },
        sessionRollback: { conversation: 'unsupported' },
        usageLimitRecovery: { checkNow: 'unsupported' },
      },
      media: { emitsSessionMedia: 'supported', nativeImageGeneration: 'unsupported' },
      handoff: { vendorStateTransfer: 'unsupported', requiresExplicitSessionId: true },
      localControl: null,
    });

    expect(resolveAgentRuntimeControlSurface('codex', 'acp')).toMatchObject({
      localControl: {
        supported: true,
        topology: 'exclusive',
        attachStrategy: 'tmux',
      },
    });
  });

});
