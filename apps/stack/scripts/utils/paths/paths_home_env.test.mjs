import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  getHappyStacksHomeDir,
  getStacksStorageRoot,
  getWorkspaceDir,
  resolveActiveStackEnvFilePath,
} from './paths.mjs';

test('stack path overrides expand ~/ against the provided HOME env', () => {
  const env = {
    HOME: '/scoped/home',
    PIGGERCODE_STACK_HOME_DIR: '~/.piggercode-stack-custom',
    PIGGERCODE_STACK_STORAGE_DIR: '~/.piggercode/stacks-custom',
  };

  assert.equal(getHappyStacksHomeDir(env), '/scoped/home/.piggercode-stack-custom');
  assert.equal(getWorkspaceDir('/tmp/root', env), '/scoped/home/.piggercode-stack-custom/workspace');
  assert.equal(getStacksStorageRoot(env), '/scoped/home/.piggercode/stacks-custom');
});

test('resolveActiveStackEnvFilePath expands ~/ explicit overrides against the provided HOME env', () => {
  const env = {
    HOME: '/scoped/home',
    PIGGERCODE_STACK_ENV_FILE: '~/.piggercode/stacks/dev/env',
  };

  assert.equal(resolveActiveStackEnvFilePath('dev', env), '/scoped/home/.piggercode/stacks/dev/env');
});

test('resolveActiveStackEnvFilePath falls back to the resolved stack env file when no explicit override is set', () => {
  const env = {
    HOME: '/scoped/home',
    PIGGERCODE_STACK_STORAGE_DIR: '~/.piggercode/stacks-custom',
  };

  assert.equal(
    resolveActiveStackEnvFilePath('dev', env),
    join('/scoped/home/.piggercode/stacks-custom', 'dev', 'env')
  );
});
