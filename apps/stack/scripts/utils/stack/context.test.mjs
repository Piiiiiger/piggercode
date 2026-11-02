import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveStackContext } from './context.mjs';

test('resolveStackContext expands ~/ explicit env file overrides against HOME', () => {
  const out = resolveStackContext({
    env: {
      HOME: '/scoped/home',
      PIGGERCODE_STACK_STACK: 'dev',
      PIGGERCODE_STACK_ENV_FILE: '~/.piggercode/stacks/dev/env',
    },
  });

  assert.equal(out.stackMode, true);
  assert.equal(out.stackName, 'dev');
  assert.equal(out.envPath, '/scoped/home/.piggercode/stacks/dev/env');
});
