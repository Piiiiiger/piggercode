import { describe, expect, it } from 'vitest';

import { evaluateExistingSessionAutomationEligibility } from './existingSessionAutomationPolicy.js';

describe('evaluateExistingSessionAutomationEligibility', () => {
  it('accepts vendor-resumable sessions with a persisted resume id', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: {
          flavor: 'claude',
          claudeSessionId: 'claude-session-1',
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'claude',
      strategy: 'vendor_resume',
    });
  });

  it('accepts runtime-descriptor sessions without legacy top-level vendor ids', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: {
          agentRuntimeDescriptorV1: {
            v: 1,
            providerId: 'codex',
            provider: { backendMode: 'appServer', vendorSessionId: 'codex-session-1' },
          },
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'codex',
      strategy: 'vendor_resume',
    });
  });

  it('rejects sessions whose agent is unknown', () => {
    expect(
      evaluateExistingSessionAutomationEligibility({
        metadata: { flavor: 'unknown-agent', vendorSessionId: 'provider-session-1' },
      }),
    ).toEqual({ eligible: false, reasonCode: 'agent_unknown' });
  });
});
