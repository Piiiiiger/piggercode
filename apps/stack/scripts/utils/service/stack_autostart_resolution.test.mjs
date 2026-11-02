import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAutostartEnvFilePath,
  resolveAutostartLogPaths,
  resolveAutostartWorkingDirectory,
} from './stack_autostart_resolution.mjs';

test('resolveAutostartEnvFilePath prefers explicit PIGGERCODE_STACK_ENV_FILE override', () => {
  assert.equal(
    resolveAutostartEnvFilePath({
      mode: 'system',
      explicitEnvFilePath: '/custom/env',
      defaultMainEnvFilePath: '/root/.piggercode/stacks/main/env',
      systemUserHomeDir: '/home/happier',
    }),
    '/custom/env'
  );
});

test('resolveAutostartEnvFilePath expands ~/ explicit overrides against the provided home dir', () => {
  assert.equal(
    resolveAutostartEnvFilePath({
      mode: 'user',
      explicitEnvFilePath: '~/.piggercode/stacks/main/env',
      defaultMainEnvFilePath: '/root/.piggercode/stacks/main/env',
      systemUserHomeDir: '',
      homeDir: '/scoped/home',
    }),
    '/scoped/home/.piggercode/stacks/main/env'
  );
});

test('resolveAutostartEnvFilePath uses system user home when installing a system service', () => {
  assert.equal(
    resolveAutostartEnvFilePath({
      mode: 'system',
      explicitEnvFilePath: '',
      defaultMainEnvFilePath: '/root/.piggercode/stacks/main/env',
      systemUserHomeDir: '/home/happier',
    }),
    '/home/happier/.piggercode/stacks/main/env'
  );
});

test('resolveAutostartEnvFilePath falls back to default when no system user is provided', () => {
  assert.equal(
    resolveAutostartEnvFilePath({
      mode: 'system',
      explicitEnvFilePath: '',
      defaultMainEnvFilePath: '/root/.piggercode/stacks/main/env',
      systemUserHomeDir: '',
    }),
    '/root/.piggercode/stacks/main/env'
  );
});

test('resolveAutostartWorkingDirectory uses %h for systemd user services', () => {
  assert.equal(
    resolveAutostartWorkingDirectory({
      platform: 'linux',
      mode: 'user',
      defaultHomeDir: '/home/me',
      systemUserHomeDir: '',
      baseDir: '/home/me/.piggercode/stacks/main',
      installedCliRoot: '/opt/happier',
    }),
    '%h'
  );
});

test('resolveAutostartWorkingDirectory uses explicit home for systemd system services', () => {
  assert.equal(
    resolveAutostartWorkingDirectory({
      platform: 'linux',
      mode: 'system',
      defaultHomeDir: '/root',
      systemUserHomeDir: '/home/happier',
      baseDir: '/root/.piggercode/stacks/main',
      installedCliRoot: '/opt/happier',
    }),
    '/home/happier'
  );
});

test('resolveAutostartWorkingDirectory uses explicit default home when system user home is unknown', () => {
  assert.equal(
    resolveAutostartWorkingDirectory({
      platform: 'linux',
      mode: 'system',
      defaultHomeDir: '/root',
      systemUserHomeDir: '',
      baseDir: '/root/.piggercode/stacks/main',
      installedCliRoot: '/opt/happier',
    }),
    '/root'
  );
});

test('resolveAutostartLogPaths uses default paths for user mode', () => {
  const res = resolveAutostartLogPaths({
    mode: 'user',
    hasStorageDirOverride: false,
    systemUserHomeDir: '/home/happier',
    stackName: 'main',
    defaultBaseDir: '/home/me/.piggercode/stacks/main',
    defaultStdoutPath: '/home/me/.piggercode/stacks/main/logs/happier-stack.out.log',
    defaultStderrPath: '/home/me/.piggercode/stacks/main/logs/happier-stack.err.log',
  });
  assert.equal(res.baseDir, '/home/me/.piggercode/stacks/main');
  assert.equal(res.stdoutPath, '/home/me/.piggercode/stacks/main/logs/happier-stack.out.log');
  assert.equal(res.stderrPath, '/home/me/.piggercode/stacks/main/logs/happier-stack.err.log');
});

test('resolveAutostartLogPaths uses system user home for system mode when storage dir is not overridden', () => {
  const res = resolveAutostartLogPaths({
    mode: 'system',
    hasStorageDirOverride: false,
    systemUserHomeDir: '/home/happier',
    stackName: 'main',
    defaultBaseDir: '/root/.piggercode/stacks/main',
    defaultStdoutPath: '/root/.piggercode/stacks/main/logs/happier-stack.out.log',
    defaultStderrPath: '/root/.piggercode/stacks/main/logs/happier-stack.err.log',
  });
  assert.equal(res.baseDir, '/home/happier/.piggercode/stacks/main');
  assert.equal(res.stdoutPath, '/home/happier/.piggercode/stacks/main/logs/happier-stack.out.log');
  assert.equal(res.stderrPath, '/home/happier/.piggercode/stacks/main/logs/happier-stack.err.log');
});
