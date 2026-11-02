import { describe, expect, it } from 'vitest';

import { ReviewProfile } from './ReviewProfile';

describe('ReviewProfile', () => {
  it('parses trailing JSON when model output includes preamble text', () => {
    const start = {
      sessionId: 'sess_1',
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'call_1',
      intent: 'review',
      backendId: 'claude',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      instructions: 'review this',
      permissionMode: 'read_only',
      retentionPolicy: 'ephemeral',
      runClass: 'bounded',
      ioMode: 'request_response',
      startedAtMs: 1,
    } as const;

    const res = ReviewProfile.onBoundedComplete({
      start,
      rawText: [
        'Sure, here are the findings.',
        '{',
        '  "summary": "Ok",',
        '  "overviewMarkdown": "## Overview\\n\\nLooks good.",',
        '  "findings": [],',
        '  "questions": [],',
        '  "assumptions": []',
        '}',
      ].join('\n'),
      finishedAtMs: 2,
    });

    expect(res.status).toBe('succeeded');
    expect(res.structuredMeta?.kind).toBe('review_findings.v2');
    expect((res.structuredMeta as any).payload?.summary).toBe('Ok');
    expect((res.structuredMeta as any).payload?.overviewMarkdown).toContain('Overview');
  });

  it('fails deterministically when model output is not strict JSON', () => {
    const start = {
      sessionId: 'sess_1',
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'call_1',
      intent: 'review',
      backendId: 'claude',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      instructions: 'review this',
      permissionMode: 'read_only',
      retentionPolicy: 'ephemeral',
      runClass: 'bounded',
      ioMode: 'request_response',
      startedAtMs: 1,
    } as const;

    const res = ReviewProfile.onBoundedComplete({
      start,
      rawText: 'not json',
      finishedAtMs: 2,
    });

    expect(res.status).toBe('failed');
    expect((res.toolResultOutput as any)?.error?.code).toBe('invalid_output');
  });

  it('rejects triage actions when start params are missing required policy fields', () => {
    const start = {
      sessionId: 'sess_1',
      runId: 'run_1',
      callId: 'call_1',
      sidechainId: 'call_1',
      intent: 'review',
      backendId: 'claude',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      instructions: 'review this',
      permissionMode: 'read_only',
      retentionPolicy: 'ephemeral',
      runClass: 'bounded',
      ioMode: 'request_response',
      startedAtMs: 1,
    } as const;

    const completed = ReviewProfile.onBoundedComplete({
      start,
      rawText: '{ "summary": "Ok", "overviewMarkdown": "Ok", "findings": [], "questions": [], "assumptions": [] }',
      finishedAtMs: 2,
    });

    expect(completed.status).toBe('succeeded');
    expect(completed.structuredMeta?.kind).toBe('review_findings.v2');

    const acted = ReviewProfile.applyAction?.({
      actionId: 'review.triage',
      input: { findings: [] },
      structuredMeta: completed.structuredMeta!,
      start: { ...start, permissionMode: '' },
    });

    expect(acted?.ok).toBe(false);
    expect((acted as any)?.errorCode).toBe('execution_run_invalid_action_input');
  });

  it('exposes review.follow_up alongside review.triage for review findings payloads', () => {
    const actionIds = ReviewProfile.listAvailableActionIds?.({
      start: {
        sessionId: 'sess_1',
        runId: 'run_1',
        callId: 'call_1',
        sidechainId: 'call_1',
        intent: 'review',
        backendId: 'claude',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        instructions: 'review this',
        permissionMode: 'read_only',
        retentionPolicy: 'resumable',
        runClass: 'bounded',
        ioMode: 'streaming',
        startedAtMs: 1,
      },
      structuredMeta: {
        kind: 'review_findings.v2',
        payload: {
          runRef: {
            runId: 'run_1',
            callId: 'call_1',
            backendId: 'claude',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
          },
          summary: 'Ok',
          overviewMarkdown: 'Ok',
          findings: [],
          questions: [],
          assumptions: [],
          generatedAtMs: 1,
        },
      },
    });

    expect(actionIds).toEqual(['review.triage', 'review.follow_up']);
  });
});
