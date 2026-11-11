import { describe, expect, it } from 'vitest';

import {
  CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE,
  CLAUDE_LOCAL_PERMISSION_BRIDGE_STOPPED_REASON,
} from '@piggercode/agents';
import { deriveActivitySummaryFromAgentState } from './deriveActivitySummaryFromAgentState';

describe('deriveActivitySummaryFromAgentState', () => {
  it('counts a prompt a terminal CLI shows as a pending request of its kind', () => {
    expect(deriveActivitySummaryFromAgentState({ terminalWaiting: { on: 'permission', since: 1 } })).toEqual({
      pendingPermissionRequestCount: 1,
      pendingUserActionRequestCount: 0,
    });
    expect(deriveActivitySummaryFromAgentState({ terminalWaiting: { on: 'question', since: 1 } })).toEqual({
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 1,
    });
    // A CLI that quit with an error keeps its terminal open until the user has read it.
    expect(deriveActivitySummaryFromAgentState({ terminalWaiting: { on: 'exited', exitCode: 1, since: 1 } })).toEqual({
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 1,
    });
    expect(deriveActivitySummaryFromAgentState({ terminalWaiting: null })).toEqual({
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 0,
    });
  });

  it('counts unresolved permission and user-action requests separately', () => {
    expect(deriveActivitySummaryFromAgentState({
      requests: {
        req_permission: {
          tool: 'Write',
          arguments: { path: '/tmp/a.ts' },
          createdAt: 1,
        },
        req_action: {
          tool: 'AskUserQuestion',
          kind: 'user_action',
          arguments: { question: 'Ship it?' },
          createdAt: 2,
        },
        req_completed: {
          tool: 'Write',
          arguments: { path: '/tmp/b.ts' },
          createdAt: 3,
        },
      },
      completedRequests: {
        req_completed: {
          tool: 'Write',
          arguments: { path: '/tmp/b.ts' },
          createdAt: 3,
          status: 'approved',
          completedAt: 4,
        },
      },
    } as any)).toEqual({
      pendingPermissionRequestCount: 1,
      pendingUserActionRequestCount: 1,
    });
  });

  it('does not count generated local-bridge requests covered by a recent canonical bridge cancellation', () => {
    const question = {
      questions: [{
        question: 'How do you want to proceed?',
        header: 'Next step',
        options: [{ label: 'Continue', description: 'Continue with attachments.' }],
      }],
    };

    expect(deriveActivitySummaryFromAgentState({
      requests: {
        'perm_generated': {
          tool: 'AskUserQuestion',
          kind: 'user_action',
          arguments: question,
          createdAt: 10_500,
          source: CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE,
        },
      },
      completedRequests: {
        'toolu_canonical': {
          tool: 'AskUserQuestion',
          kind: 'user_action',
          arguments: question,
          createdAt: 1_000,
          completedAt: 10_000,
          status: 'canceled',
          reason: CLAUDE_LOCAL_PERMISSION_BRIDGE_STOPPED_REASON,
          source: CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE,
        },
      },
    } as any)).toEqual({
      pendingPermissionRequestCount: 0,
      pendingUserActionRequestCount: 0,
    });
  });
});
