import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfUpdateHarness } from './testkit/self_update_testkit.mjs';

test('hstack self check uses PIGGERCODE_STACK_UPDATE_PACKAGE_NAME when set', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-override-' });
  const res = harness.runSelfCommand(['check', '--quiet'], {
    extraEnv: { PIGGERCODE_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @company/hstack@latest version'));
});

test('hstack self check defaults to invoker package.json name', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-default-' });
  const res = harness.runSelfCommand(['check', '--quiet']);
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @piggercode/stack@latest version'));
});

test('hstack self check ignores invalid PIGGERCODE_STACK_UPDATE_PACKAGE_NAME', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-invalid-' });
  const res = harness.runSelfCommand(['check', '--quiet'], {
    extraEnv: { PIGGERCODE_STACK_UPDATE_PACKAGE_NAME: '../evil' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @piggercode/stack@latest version'));
});

test('hstack self check --preview uses next dist-tag with valid package override', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-preview-override-' });
  const res = harness.runSelfCommand(['check', '--preview', '--quiet'], {
    extraEnv: { PIGGERCODE_STACK_UPDATE_PACKAGE_NAME: '@company/hstack' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @company/hstack@next version'));
});

test('hstack self check --preview falls back to default package name for invalid override', (t) => {
  const harness = createSelfUpdateHarness(t, { prefix: 'hstack-npm-preview-invalid-' });
  const res = harness.runSelfCommand(['check', '--preview', '--quiet'], {
    extraEnv: { PIGGERCODE_STACK_UPDATE_PACKAGE_NAME: 'not/a/valid/name!' },
  });
  assert.equal(res.status, 0);

  const log = harness.readNpmArgsLog();
  assert.ok(log.includes('view @piggercode/stack@next version'));
});
