import { describe, expect, it } from 'vitest';

import { PIGGERCODE_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceTargetMaterializedRoot } from './resolveConnectedServiceTargetMaterializedRoot';

describe('resolveConnectedServiceTargetMaterializedRoot', () => {

  it('resolves Codex materialized root from CODEX_HOME or CODEX_SQLITE_HOME', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'codex',
      targetMaterializedEnv: {
        CODEX_HOME: '/tmp/materialized/codex-home',
      },
    })).toBe('/tmp/materialized');

    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'codex',
      targetMaterializedEnv: {
        CODEX_SQLITE_HOME: '/tmp/materialized/codex-home',
      },
    })).toBe('/tmp/materialized');
  });

  it('resolves Claude materialized root from CLAUDE_CONFIG_DIR', () => {
    expect(resolveConnectedServiceTargetMaterializedRoot({
      agentId: 'claude',
      targetMaterializedEnv: {
        CLAUDE_CONFIG_DIR: '/tmp/materialized/claude-config',
      },
    })).toBe('/tmp/materialized');
  });

});
