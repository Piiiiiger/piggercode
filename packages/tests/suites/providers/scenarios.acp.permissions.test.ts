import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  makeAcpPermissionDenyOutsideWorkspaceReadScenario,
  makeAcpPermissionDenyReadScenario,
  makeAcpPermissionExecuteWritesWorkspaceFileScenario,
  makeAcpPermissionOutsideWorkspaceScenario,
  makeAcpPermissionPatchApplyScenario,
} from '../../src/testkit/providers/scenarios/scenarios.acp';
import type { ProviderFixtureExamples, ProviderTraceEvent } from '../../src/testkit/providers/types';

function buildVerifyContext(input: {
  workspaceDir: string;
  fixtures?: ProviderFixtureExamples;
  traceEvents?: ProviderTraceEvent[];
}) {
  return {
    workspaceDir: input.workspaceDir,
    fixtures: { examples: input.fixtures ?? {} },
    traceEvents: input.traceEvents ?? [],
    baseUrl: 'http://127.0.0.1:1',
    token: 'token',
    sessionId: 'session',
    resumeSessionId: null,
    secret: new Uint8Array(32),
    resumeId: null,
  };
}

function tracePermissionRequestEvent(): ProviderTraceEvent {
  return {
    v: 1,
    sessionId: 'session',
    protocol: 'acp',
    provider: 'codex',
    kind: 'permission-request',
    payload: { type: 'permission-request' },
  };
}

describe('providers: ACP scenario builders (permissions)', () => {
  it('can disable permission-request fixture requirements for providers that auto-approve edits', () => {
    const scenario = makeAcpPermissionOutsideWorkspaceScenario({
      providerId: 'codex',
      content: 'AUTO_APPROVED',
      decision: 'approve',
      expectPermissionRequest: false,
    });

    const buckets = scenario.requiredAnyFixtureKeys ?? [];
    const flattened = buckets.flat();
    const hasPermissionRequest = flattened.some((key) => key.includes('/permission-request/'));
    expect(hasPermissionRequest).toBe(false);
  });

  it('builds an execute permission scenario that asserts permission-request trace + workspace file side effect (approve)', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-acp-execperm-'));
    try {
      const scenario = makeAcpPermissionExecuteWritesWorkspaceFileScenario({
        providerId: 'codex',
        filename: 'e2e-exec-perm.txt',
        content: 'EXEC_PERM_OK',
        decision: 'approve',
      });

      expect(scenario.yolo).toBe(false);
      expect(scenario.permissionAutoDecision).toBe('approved');
      await writeFile(join(workspaceDir, 'e2e-exec-perm.txt'), 'EXEC_PERM_OK\n', 'utf8');

      await scenario.verify?.(buildVerifyContext({ workspaceDir, traceEvents: [tracePermissionRequestEvent()] }));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('builds an execute permission scenario that asserts permission-request trace + no workspace file side effect (deny)', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-acp-execperm-'));
    try {
      const scenario = makeAcpPermissionExecuteWritesWorkspaceFileScenario({
        providerId: 'codex',
        filename: 'e2e-exec-perm.txt',
        content: 'EXEC_PERM_NO',
        decision: 'deny',
      });

      expect(scenario.yolo).toBe(false);
      expect(scenario.permissionAutoDecision).toBe('denied');

      await scenario.verify?.(buildVerifyContext({ workspaceDir, traceEvents: [tracePermissionRequestEvent()] }));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('builds a patch-apply permission scenario that asserts permission-request trace + file content update (approve)', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-acp-patchperm-'));
    try {
      const scenario = makeAcpPermissionPatchApplyScenario({
        providerId: 'codex',
        filename: 'e2e-patch-perm.txt',
        before: 'PATCH_BEFORE',
        after: 'PATCH_AFTER',
        decision: 'approve',
      });

      await scenario.setup?.({ workspaceDir, cliHome: workspaceDir });
      await writeFile(join(workspaceDir, 'e2e-patch-perm.txt'), 'PATCH_AFTER\n', 'utf8');

      await scenario.verify?.(buildVerifyContext({ workspaceDir, traceEvents: [tracePermissionRequestEvent()] }));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('builds a patch-apply permission scenario that asserts permission-request trace + file content unchanged (deny)', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-acp-patchperm-'));
    try {
      const scenario = makeAcpPermissionPatchApplyScenario({
        providerId: 'codex',
        filename: 'e2e-patch-perm.txt',
        before: 'PATCH_BEFORE',
        after: 'PATCH_AFTER',
        decision: 'deny',
      });

      await scenario.setup?.({ workspaceDir, cliHome: workspaceDir });
      await scenario.verify?.(buildVerifyContext({ workspaceDir, traceEvents: [tracePermissionRequestEvent()] }));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('builds a patch-apply scenario without permission-request requirements when prompts are disabled', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-acp-patchperm-noprompt-'));
    try {
      const scenario = makeAcpPermissionPatchApplyScenario({
        providerId: 'codex',
        filename: 'e2e-patch-perm.txt',
        before: 'PATCH_BEFORE',
        after: 'PATCH_AFTER',
        decision: 'approve',
        expectPermissionRequest: false,
      });

      await scenario.setup?.({ workspaceDir, cliHome: workspaceDir });
      await writeFile(join(workspaceDir, 'e2e-patch-perm.txt'), 'PATCH_AFTER\n', 'utf8');
      expect((scenario.requiredTraceSubstrings ?? []).some((value) => value.includes('permission-request'))).toBe(false);

      await scenario.verify?.(buildVerifyContext({ workspaceDir, traceEvents: [] }));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
