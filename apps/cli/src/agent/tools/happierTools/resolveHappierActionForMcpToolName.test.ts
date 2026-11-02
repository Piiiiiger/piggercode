import { describe, expect, it } from 'vitest';

import {
  isSafeFirstPartyHappierActionToolCall,
  resolveHappierActionForMcpToolName,
} from './resolveHappierActionForMcpToolName';

describe('resolveHappierActionForMcpToolName', () => {
  it('maps first-party provider-prefixed MCP tools to their PiggerCode action ids', () => {
    expect(resolveHappierActionForMcpToolName({
      toolName: 'mcp__piggercode__session_list',
      input: {},
    })).toBe('session.list');
    expect(resolveHappierActionForMcpToolName({
      toolName: 'piggercode_action_execute',
      input: { actionId: 'session.status.get' },
    })).toBe('session.status.get');
    expect(resolveHappierActionForMcpToolName({
      toolName: 'piggercode__session_list',
      input: {},
    })).toBe('session.list');
    expect(resolveHappierActionForMcpToolName({
      toolName: 'piggercode__action_execute',
      input: { actionId: 'session.status.get' },
    })).toBe('session.status.get');
    expect(resolveHappierActionForMcpToolName({
      toolName: 'mcp__not_piggercode__session_list',
      input: {},
    })).toBeNull();
  });

  it('recognizes only safe first-party Action transport calls', () => {
    expect(isSafeFirstPartyHappierActionToolCall({
      toolName: 'mcp__piggercode__action_execute',
      input: { actionId: 'execution.run.start' },
    })).toBe(true);
    expect(isSafeFirstPartyHappierActionToolCall({
      toolName: 'mcp__piggercode__action_execute',
      input: { actionId: 'prompt_asset.export' },
    })).toBe(false);
    expect(isSafeFirstPartyHappierActionToolCall({
      toolName: 'mcp__piggercode__action_execute',
      input: { actionId: 'not.a.known.action' },
    })).toBe(false);
    expect(isSafeFirstPartyHappierActionToolCall({
      toolName: 'mcp__custom__execution_run_start',
      input: {},
    })).toBe(false);
  });
});
