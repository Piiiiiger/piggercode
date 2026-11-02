import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeEnvForTuiSummary } from './summary_env.mjs';

test('mergeEnvForTuiSummary prefers process env values over stack env file', () => {
  const out = mergeEnvForTuiSummary({
    stackEnvFromFile: { PIGGERCODE_STACK_REPO_DIR: '/from/file', PIGGERCODE_STACK_STACK: 'file' },
    processEnv: { PIGGERCODE_STACK_REPO_DIR: '/from/process', PIGGERCODE_STACK_STACK: 'process' },
  });
  assert.equal(out.PIGGERCODE_STACK_REPO_DIR, '/from/process');
  assert.equal(out.PIGGERCODE_STACK_STACK, 'process');
});

test('mergeEnvForTuiSummary falls back to stack env file when process env is missing', () => {
  const out = mergeEnvForTuiSummary({
    stackEnvFromFile: { PIGGERCODE_STACK_REPO_DIR: '/from/file' },
    processEnv: {},
  });
  assert.equal(out.PIGGERCODE_STACK_REPO_DIR, '/from/file');
});

