import { describe, expect, it } from 'vitest';

import { checkMaxTraceEvents, hasTraceForKey, scenarioSatisfiedByTrace } from '../../src/testkit/providers/satisfaction/traceSatisfaction';

describe('providers: trace satisfaction correlation', () => {

  it('correlates Claude tool_result to tool_use via tool_use_id', () => {
    const events: any[] = [
      {
        v: 1,
        sessionId: 's1',
        protocol: 'claude',
        provider: 'claude',
        kind: 'tool-call',
        payload: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
      },
      {
        v: 1,
        sessionId: 's1',
        protocol: 'claude',
        provider: 'claude',
        kind: 'tool-result',
        payload: { type: 'tool_result', tool_use_id: 'toolu_1', content: [] },
      },
    ];

    expect(hasTraceForKey(events as any, 'claude/claude/tool-result/Read')).toBe(true);
  });

});
