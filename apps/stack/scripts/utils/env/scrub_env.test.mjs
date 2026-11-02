import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SANDBOX_PRESERVE_KEYS,
  STACK_WRAPPER_PRESERVE_KEYS,
  scrubHappierStackEnv,
} from './scrub_env.mjs';

test('scrubHappierStackEnv removes non-preserved PIGGERCODE_STACK_* vars and clears selected unprefixed keys', () => {
  const env = {
    PATH: '/bin',
    PIGGERCODE_STACK_VERBOSE: '1',
    PIGGERCODE_STACK_FOO: 'bar',
    PIGGERCODE_HOME_DIR: '/tmp/happier-home',
    PIGGERCODE_SERVER_URL: 'http://example.com',
  };

  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: SANDBOX_PRESERVE_KEYS,
    clearUnprefixedKeys: ['PIGGERCODE_HOME_DIR', 'PIGGERCODE_SERVER_URL'],
  });

  assert.equal(scrubbed.PATH, '/bin');
  assert.equal(scrubbed.PIGGERCODE_STACK_VERBOSE, '1');
  assert.equal(scrubbed.PIGGERCODE_STACK_FOO, undefined);
  assert.equal(scrubbed.PIGGERCODE_HOME_DIR, undefined);
  assert.equal(scrubbed.PIGGERCODE_SERVER_URL, undefined);
});

test('scrubHappierStackEnv keeps runtime-critical non-HAPPIER env keys', () => {
  const env = {
    PATH: '/bin:/usr/bin',
    HOME: '/tmp/home',
    TMPDIR: '/tmp',
    SHELL: '/bin/zsh',
    PIGGERCODE_STACK_SECRET: 'drop-me',
  };

  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: [],
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.PATH, '/bin:/usr/bin');
  assert.equal(scrubbed.HOME, '/tmp/home');
  assert.equal(scrubbed.TMPDIR, '/tmp');
  assert.equal(scrubbed.SHELL, '/bin/zsh');
  assert.equal(scrubbed.PIGGERCODE_STACK_SECRET, undefined);
});

test('scrubHappierStackEnv preserves only explicitly kept PIGGERCODE_STACK keys', () => {
  const env = {
    PIGGERCODE_STACK_VERBOSE: '1',
    PIGGERCODE_STACK_SANDBOX_DIR: '/tmp/sandbox',
    PIGGERCODE_STACK_SECRET: 'drop-me',
  };
  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: [' PIGGERCODE_STACK_SANDBOX_DIR ', ''],
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.PIGGERCODE_STACK_SANDBOX_DIR, '/tmp/sandbox');
  assert.equal(scrubbed.PIGGERCODE_STACK_VERBOSE, undefined);
  assert.equal(scrubbed.PIGGERCODE_STACK_SECRET, undefined);
});

test('scrubHappierStackEnv trims and de-duplicates clearUnprefixedKeys', () => {
  const env = {
    PATH: '/bin',
    PIGGERCODE_HOME_DIR: '/tmp/home',
    PIGGERCODE_SERVER_URL: 'http://localhost:3000',
    PIGGERCODE_STACK_KEEP: 'keep',
  };
  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: ['PIGGERCODE_STACK_KEEP'],
    clearUnprefixedKeys: [' PIGGERCODE_HOME_DIR ', 'PIGGERCODE_SERVER_URL', 'PIGGERCODE_SERVER_URL'],
  });

  assert.equal(scrubbed.PATH, '/bin');
  assert.equal(scrubbed.PIGGERCODE_HOME_DIR, undefined);
  assert.equal(scrubbed.PIGGERCODE_SERVER_URL, undefined);
  assert.equal(scrubbed.PIGGERCODE_STACK_KEEP, 'keep');
});

test('scrubHappierStackEnv preserves PIGGERCODE_STACK_TUI in stack wrapper mode', () => {
  const env = {
    PATH: '/bin',
    PIGGERCODE_STACK_TUI: '1',
    PIGGERCODE_STACK_RESCUE: '1',
    PIGGERCODE_STACK_VERBOSE: '1',
    PIGGERCODE_STACK_LISTENER_OWNERSHIP_TIMEOUT_MS: '90000',
    PIGGERCODE_STACK_SECRET: 'drop-me',
  };
  const scrubbed = scrubHappierStackEnv(env, {
    keepHappierStackKeys: STACK_WRAPPER_PRESERVE_KEYS,
    clearUnprefixedKeys: [],
  });

  assert.equal(scrubbed.PATH, '/bin');
  assert.equal(scrubbed.PIGGERCODE_STACK_TUI, '1');
  assert.equal(scrubbed.PIGGERCODE_STACK_RESCUE, '1');
  assert.equal(scrubbed.PIGGERCODE_STACK_VERBOSE, '1');
  assert.equal(scrubbed.PIGGERCODE_STACK_LISTENER_OWNERSHIP_TIMEOUT_MS, '90000');
  assert.equal(scrubbed.PIGGERCODE_STACK_SECRET, undefined);
});
