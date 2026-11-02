import test from 'node:test';
import assert from 'node:assert/strict';

import { readBundledWorkspaceSyncConfig } from './readBundledWorkspaceSyncConfig.mjs';

test('readBundledWorkspaceSyncConfig derives stack workspace packages from bundledDependencies', () => {
  const config = readBundledWorkspaceSyncConfig('/repo/apps/stack', {
    existsSync: (candidate) => candidate === '/repo/apps/stack/package.json',
    readFileSync: () => JSON.stringify({
      bundledDependencies: [
        '@piggercode/agents',
        '@piggercode/cli-common',
        '@piggercode/connection-supervisor',
        'qrcode',
        '@piggercode/protocol',
        '@piggercode/release-runtime',
      ],
    }),
  });

  assert.deepEqual(config, {
    hostApps: ['stack'],
    packages: ['agents', 'cli-common', 'connection-supervisor', 'protocol', 'release-runtime'],
  });
});

test('readBundledWorkspaceSyncConfig returns null when package.json is unavailable', () => {
  const config = readBundledWorkspaceSyncConfig('/repo/apps/stack', {
    existsSync: () => false,
  });

  assert.equal(config, null);
});
