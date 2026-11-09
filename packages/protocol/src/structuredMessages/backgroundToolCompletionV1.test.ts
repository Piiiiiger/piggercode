import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_TOOL_COMPLETION_KIND,
  buildBackgroundToolCompletionInputV1,
} from './backgroundToolCompletionV1.js';

describe('buildBackgroundToolCompletionInputV1', () => {
  it('tells the agent which call finished and carries the payload the app renders', () => {
    const input = buildBackgroundToolCompletionInputV1({
      v: 1,
      callId: 'call_1',
      toolName: 'mcp__piggercode__machine_command_run',
      status: 'completed',
      finishedAtMs: 42,
    });

    expect(input.text).toContain('not a user message');
    expect(input.text).toContain('has finished');
    expect(input.text).toContain('Tool: mcp__piggercode__machine_command_run');
    expect(input.text).toContain('Call ID: call_1');
    expect(input.meta.happier).toEqual({
      kind: BACKGROUND_TOOL_COMPLETION_KIND,
      payload: { v: 1, callId: 'call_1', toolName: 'mcp__piggercode__machine_command_run', status: 'completed', finishedAtMs: 42 },
    });
  });

  it('says a failed call failed', () => {
    expect(buildBackgroundToolCompletionInputV1({
      v: 1,
      callId: 'call_1',
      toolName: 'mcp__piggercode__machine_command_run',
      status: 'failed',
      finishedAtMs: 42,
    }).text).toContain('has failed');
  });
});
