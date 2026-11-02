import { describe, expect, it } from 'vitest';

import { AGENTS_CORE } from '../manifest.js';

import {
    evaluateAgentSessionCapabilitySupport,
    getAgentSessionCapability,
    isAgentSessionCapabilitySupported,
} from './sessionCapabilities.js';

describe('sessionCapabilities', () => {

  it('downgrades codex conversation capabilities when the session is not app-server backed', () => {
    expect(
      evaluateAgentSessionCapabilitySupport({
        agentId: 'codex',
        capability: 'sessionFork.conversation',
        metadata: { codexSessionId: 'c1', codexBackendMode: 'mcp' },
      }),
    ).toBe('unsupported');

    expect(
      evaluateAgentSessionCapabilitySupport({
        agentId: 'codex',
        capability: 'sessionRollback.conversation',
        metadata: {
          codexSessionId: 'c1',
          sessionConfigOptionsV1: { v: 1, provider: 'codex', updatedAt: 1, options: [] },
        },
      }),
    ).toBe('supported');

    expect(
      evaluateAgentSessionCapabilitySupport({
        agentId: 'codex',
        capability: 'usageLimitRecovery.checkNow',
        metadata: { codexSessionId: 'c1', codexBackendMode: 'mcp' },
      }),
    ).toBe('unsupported');

    expect(
      evaluateAgentSessionCapabilitySupport({
        agentId: 'codex',
        capability: 'usageLimitRecovery.checkNow',
        metadata: {
          codexSessionId: 'c1',
          agentRuntimeDescriptorV1: {
            v: 1,
            providerId: 'codex',
            provider: { backendMode: 'appServer' },
          },
        },
      }),
    ).toBe('supported');
  });

});
