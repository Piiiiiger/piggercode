import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  makeAcpEditResultIncludesDiffScenario,
  makeAcpGlobListFilesScenario,
  makeAcpMultiFileEditIncludesDiffScenario,
  makeAcpMultiFileEditScenario,
  makeAcpPatchIncludesDiffScenario,
  makeAcpReadMissingFileScenario,
  makeAcpSearchLsEquivalenceScenario,
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

function traceEvent(payload: unknown): ProviderTraceEvent {
  return {
    v: 1,
    sessionId: 'session',
    protocol: 'acp',
    provider: 'codex',
    kind: 'tool-call',
    payload,
  };
}

describe('providers: ACP scenario builders (fs/search)', () => {

  it('builds a glob list files scenario that accepts either Bash or CodeSearch-style tools', () => {
    const scenario = makeAcpGlobListFilesScenario({
      providerId: 'codex',
      filenames: ['e2e-a.txt', 'e2e-b.txt'],
    });

    const flat = (scenario.requiredAnyFixtureKeys ?? []).flat();
    expect(flat.some((key) => key.endsWith('/tool-call/Bash'))).toBe(true);
    expect(flat.some((key) => key.endsWith('/tool-call/CodeSearch'))).toBe(true);
    expect(flat.some((key) => key.endsWith('/tool-result/Bash'))).toBe(true);
    expect(flat.some((key) => key.endsWith('/tool-result/CodeSearch'))).toBe(true);
  });

  it('search+ls equivalence step 1 accepts either Bash or CodeSearch fixtures', () => {
    const scenario = makeAcpSearchLsEquivalenceScenario({
      providerId: 'codex',
      filenames: ['e2e-a.txt', 'e2e-b.txt'],
      token: 'SEARCH_LS_TOKEN',
    });

    const step = (scenario.steps ?? []).find((item) => item?.id === 'ls');
    expect(step).toBeTruthy();

    const flat = (step?.satisfaction?.requiredAnyFixtureKeys ?? []).flat();
    expect(flat.some((key) => key.includes('/tool-call/Bash') || key.includes('/tool-call/CodeSearch'))).toBe(true);
    expect(flat.some((key) => key.includes('/tool-result/Bash') || key.includes('/tool-result/CodeSearch'))).toBe(true);
    expect(flat.some((key) => key.includes('/tool-call/CodeSearch'))).toBe(true);
    expect(flat.some((key) => key.includes('/tool-result/CodeSearch'))).toBe(true);
  });

  it('search+ls equivalence requiredAnyFixtureKeys does not require Bash when CodeSearch is used for ls', () => {
    const scenario = makeAcpSearchLsEquivalenceScenario({
      providerId: 'codex',
      filenames: ['e2e-a.txt', 'e2e-b.txt'],
      token: 'SEARCH_LS_TOKEN',
    });

    const bucket = (scenario.requiredAnyFixtureKeys ?? []).find((keys) =>
      keys.some((key) => key.endsWith('/tool-call/Bash')),
    );
    expect(bucket).toBeTruthy();
    expect(bucket?.some((key) => key.endsWith('/tool-call/CodeSearch'))).toBe(true);
  });

  it('builds a multi-file edit scenario that asserts diff-like evidence in trace events', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'happier-acp-multi-diff-'));
    try {
      const scenario = makeAcpMultiFileEditIncludesDiffScenario({
        providerId: 'codex',
        files: [
          { filename: 'a.txt', before: 'A_BEFORE', after: 'A_AFTER' },
          { filename: 'b.txt', before: 'B_BEFORE', after: 'B_AFTER' },
        ],
      });

      expect(scenario.id).toBe('multi_file_edit_in_workspace_includes_diff');
      expect(Array.isArray(scenario.steps)).toBe(true);
      expect(scenario.steps).toHaveLength(2);
      const firstPrompt = scenario.steps?.[0]?.prompt({ workspaceDir }) ?? '';
      expect(firstPrompt).toContain('Patch tool');
      expect(firstPrompt).toContain('First, use the Read tool');
      expect(firstPrompt).toContain('Do not use execute');

      await scenario.setup?.({ workspaceDir, cliHome: workspaceDir });
      await writeFile(join(workspaceDir, 'a.txt'), 'A_AFTER\n', 'utf8');
      await writeFile(join(workspaceDir, 'b.txt'), 'B_AFTER\n', 'utf8');

      await scenario.verify?.(
        buildVerifyContext({
          workspaceDir,
          traceEvents: [
            traceEvent({
              type: 'tool-call',
              name: 'Patch',
              input: { changes: { 'a.txt': { before: 'A_BEFORE', after: 'A_AFTER' } } },
            }),
          ],
        }),
      );
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

});
