import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor';

function createDeps(overrides: Partial<ActionExecutorDeps> = {}): ActionExecutorDeps {
  return {
    executionRunStart: async () => ({ runId: 'run_1', callId: 'call_1', sidechainId: 'call_1' }),
    executionRunList: async () => ({}),
    executionRunGet: async () => ({}),
    executionRunSend: async () => ({}),
    executionRunStop: async () => ({}),
    executionRunAction: async () => ({}),
    executionRunWait: async () => ({}),
    sessionOpen: async () => ({}),
    sessionFork: async () => ({}),
    sessionRollback: async () => ({}),
    sessionSpawnNew: async () => ({}),
    sessionSpawnPicker: async () => ({}),
    pathsListRecent: async () => ({ items: [] }),
    machinesList: async () => ({ items: [] }),
    serversList: async () => ({ items: [] }),
    reviewEnginesList: async () => ({ items: [] }),
    agentsBackendsList: async () => ({ items: [] }),
    agentsModelsList: async () => ({ items: [] }),
    sessionSendMessage: async () => ({}),
    sessionPermissionRespond: async () => ({}),
    sessionUserActionAnswer: async () => ({}),
    sessionModeSet: async () => ({}),
    sessionModesList: async () => ({ items: [] }),
    sessionTargetPrimarySet: async () => ({}),
    sessionTargetTrackedSet: async () => ({}),
    sessionList: async () => ({}),
    sessionActivityGet: async () => ({}),
    sessionRecentMessagesGet: async () => ({}),
    daemonMemorySearch: async () => ({ v: 1, ok: true as const, hits: [] }),
    daemonMemoryGetWindow: async () => ({ v: 1, snippets: [], citations: [] }),
    daemonMemoryEnsureUpToDate: async () => ({ ok: true }),
    resetGlobalVoiceAgent: async () => {},
    ...overrides,
  };
}

describe('createActionExecutor (review.start)', () => {
  it('starts resumable review runs with ioMode=streaming so sidechain progress can stream', async () => {
    const executionRunStart = vi.fn(async () => ({ runId: 'run_1', callId: 'call_1', sidechainId: 'call_1' }));

    const executor = createActionExecutor(createDeps({ executionRunStart }));

    const res = await executor.execute(
      'review.start',
      {
        sessionId: 's1',
        engineIds: ['claude'],
        instructions: 'Review this.',
        permissionMode: 'read_only',
        changeType: 'committed',
        base: { kind: 'none' },
      },
      { defaultSessionId: 's1' },
    );

    expect(res.ok).toBe(true);
    expect(executionRunStart).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        intent: 'review',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        retentionPolicy: 'resumable',
        ioMode: 'streaming',
      }),
      undefined,
    );
  });

  it('rejects current-session review fanout', async () => {
    const executionRunStart = vi.fn(async () => ({ runId: 'run_1', callId: 'call_1', sidechainId: 'call_1' }));
    const reviewStartInline = vi.fn(async () => ({ ok: true, reviewTurnId: 'turn_1' }));
    const executor = createActionExecutor(createDeps({ executionRunStart, reviewStartInline }));

    const res = await executor.execute(
      'review.start',
      {
        sessionId: 's1',
        engineIds: ['codex', 'claude'],
        runLocation: 'current_session',
      },
      { defaultSessionId: 's1' },
    );

    expect(res).toEqual({
      ok: false,
      errorCode: 'inline_review_requires_single_engine',
      error: 'inline_review_requires_single_engine',
    });
    expect(reviewStartInline).not.toHaveBeenCalled();
    expect(executionRunStart).not.toHaveBeenCalled();
  });

  it('reports unsupported current-session reviews when no inline dependency is available', async () => {
    const executionRunStart = vi.fn(async () => ({ runId: 'run_1', callId: 'call_1', sidechainId: 'call_1' }));
    const executor = createActionExecutor(createDeps({ executionRunStart }));

    const res = await executor.execute(
      'review.start',
      {
        sessionId: 's1',
        engineIds: ['codex'],
        runLocation: 'current_session',
      },
      { defaultSessionId: 's1' },
    );

    expect(res).toEqual({
      ok: false,
      errorCode: 'inline_review_not_supported',
      error: 'inline_review_not_supported',
    });
    expect(executionRunStart).not.toHaveBeenCalled();
  });
});
