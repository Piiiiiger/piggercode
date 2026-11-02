import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTuiStackAuthScopeEnv } from './stack_scope_env.mjs';

test('applyTuiStackAuthScopeEnv overrides PIGGERCODE_ACTIVE_SERVER_ID per stack', () => {
  const env = applyTuiStackAuthScopeEnv({
    env: {
      PIGGERCODE_ACTIVE_SERVER_ID: 'main',
      PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID: 'stack_other__id_default',
      PIGGERCODE_STACK_CLI_IDENTITY: 'default',
    },
    stackName: 'repo-dev-a1cc5e0671',
  });
  assert.equal(env.PIGGERCODE_ACTIVE_SERVER_ID, 'stack_repo-dev-a1cc5e0671__id_default');
  assert.equal(env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID, 'stack_repo-dev-a1cc5e0671__id_default');
});

test('applyTuiStackAuthScopeEnv deletes PIGGERCODE_ACTIVE_SERVER_ID when stable scope is disabled', () => {
  const env = applyTuiStackAuthScopeEnv({
    env: { PIGGERCODE_ACTIVE_SERVER_ID: 'main', PIGGERCODE_STACK_DISABLE_STABLE_SCOPE: '1' },
    stackName: 'repo-dev-a1cc5e0671',
  });
  assert.equal(env.PIGGERCODE_ACTIVE_SERVER_ID, undefined);
  assert.equal(env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID, undefined);
});
