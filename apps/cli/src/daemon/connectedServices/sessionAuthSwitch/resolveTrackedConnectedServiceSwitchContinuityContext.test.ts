import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveTrackedConnectedServiceSwitchContinuityContext } from './resolveTrackedConnectedServiceSwitchContinuityContext';

function resolveTestCandidatePersistedSessionFile(_agentId: string, metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).codexSessionFile;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

describe('resolveTrackedConnectedServiceSwitchContinuityContext', () => {

  it('proves against the freshly materialized selection env/root instead of the pre-switch tracked env (RD-SW-2)', () => {
    // A tracked CONNECTED Claude session switching to another profile: the inherited env points at
    // the OLD member's home. When the switch already rematerialized the target (the selection
    // carries the post-materialization env/root), the continuity proof context must be the NEW home.
    const baseDir = '/tmp/happier-connected-services';
    const oldConfigDir = '/homes/claude-subscription/old-member/claude/claude-config';
    const newConfigDir = '/homes/claude-subscription/new-member/claude/claude-config';

    expect(resolveTrackedConnectedServiceSwitchContinuityContext({
      agentId: 'claude',
      baseDir,
      tracked: {
        spawnOptions: {
          directory: '/tmp/project',
          resume: 'claude-session-1',
          environmentVariables: {
            PIGGERCODE_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT: oldConfigDir,
            CLAUDE_CONFIG_DIR: oldConfigDir,
          },
          connectedServiceMaterializationIdentityV1: {
            v: 1,
            id: 'csm_claude',
            createdAtMs: 1,
          },
        },
      },
      runtimeAuthSelection: {
        profileId: 'new-member',
        targetMaterializedEnv: { CLAUDE_CONFIG_DIR: newConfigDir },
        targetMaterializedRoot: newConfigDir,
      },
    })).toMatchObject({
      targetMaterializedRoot: newConfigDir,
      targetMaterializedEnv: {
        PIGGERCODE_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT: newConfigDir,
        CLAUDE_CONFIG_DIR: newConfigDir,
      },
      vendorResumeId: 'claude-session-1',
      cwd: '/tmp/project',
    });
  });
});
