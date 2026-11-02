import { describe, expect, it } from 'vitest';

import type { ProviderTraceEvent } from '../types';
import { checkMaxTraceEvents, hasTraceForKey, scenarioSatisfiedByTrace } from './traceSatisfaction';

describe('providers: traceSatisfaction completed resume phase', () => {
  const toolEvents: ProviderTraceEvent[] = [
    { v: 1, sessionId: 's1', protocol: 'acp', provider: 'codex', kind: 'tool-call', payload: { callId: 'c1', name: 'Bash' } },
    { v: 1, sessionId: 's1', protocol: 'acp', provider: 'codex', kind: 'tool-result', payload: { callId: 'c1', output: 'PHASE1' } },
  ];
  const satisfaction = { requiredFixtureKeys: ['acp/codex/tool-result/Bash'] };

  it('accepts message completion and preserves tool-only satisfaction when no completion gate is requested', () => {
    expect(scenarioSatisfiedByTrace(toolEvents, satisfaction, {
      providerProtocol: 'acp',
      decodedMessagesSeen: [{ type: 'task_complete', id: 'completed-turn' }],
      taskCompleteCountAtStepSatisfaction: 0,
    })).toBe(true);
    expect(scenarioSatisfiedByTrace(toolEvents, satisfaction)).toBe(true);
    expect(scenarioSatisfiedByTrace(toolEvents, satisfaction, {
      providerProtocol: 'acp',
      allowInFlightSteer: true,
      decodedMessagesSeen: [],
      taskCompleteCountAtStepSatisfaction: null,
    })).toBe(true);
  });
});
