import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canResumeFromMaterializedState } from './canResumeFromMaterializedState';

describe('canResumeFromMaterializedState', () => {
  it('requires the real provider to prove target continuity even when a manifest points at an existing old-home rollout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-can-resume-old-home-'));
    const vendorResumeId = '019f2339-9299-7e51-b192-9751a0a03586';
    const targetRoot = join(root, 'target');
    const targetHome = join(targetRoot, 'codex-home');
    const oldSessions = join(root, 'old-home', 'sessions');
    const candidate = join(oldSessions, `rollout-2026-10-11T10-00-00-${vendorResumeId}.jsonl`);
    try {
      await mkdir(oldSessions, { recursive: true });
      await mkdir(join(targetHome, 'sessions'), { recursive: true });
      await writeFile(candidate, '{}\n');
      await expect(canResumeFromMaterializedState({
        agentId: 'codex', serviceId: 'openai-codex',
        targetMaterializedRoot: targetRoot,
        targetMaterializedEnv: { CODEX_HOME: targetHome, CODEX_SQLITE_HOME: targetHome },
        requestedStateMode: 'isolated', effectiveStateMode: 'isolated',
        materializationIdentity: { v: 1, id: 'csm_old_home' },
        vendorResumeId, cwd: root,
        manifest: {
          v: 1, requestedStateMode: 'isolated', effectiveStateMode: 'isolated', lastSyncAtMs: 1,
          configEntries: [], stateEntries: [], diagnostics: [],
          sessionFileMappings: [{ vendorResumeId, sourcePath: null, destinationPath: candidate, importedAtMs: 1, verifiedAtMs: null }],
        },
      })).resolves.toMatchObject({ ok: false, reason: 'codex_session_file_not_found' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
