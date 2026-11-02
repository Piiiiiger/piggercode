import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveBundledWorkspaceDependencyBuildOrder,
  resolveWorkspaceDependencyBuildOrder,
} from './resolveWorkspaceDependencyBuildOrder.mjs';

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('resolveBundledWorkspaceDependencyBuildOrder walks internal workspace dependencies before dependents', async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'happier-workspace-build-order-'));
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  await mkdir(join(repoRoot, 'apps', 'cli'), { recursive: true });
  await writeJson(join(repoRoot, 'apps', 'cli', 'package.json'), {
    bundledDependencies: [
      '@piggercode/cli-common',
      '@piggercode/release-runtime',
      '@piggercode/agents',
      '@piggercode/protocol',
    ],
  });

  const packages = {
    protocol: {
      name: '@piggercode/protocol',
    },
    agents: {
      name: '@piggercode/agents',
      dependencies: {
        '@piggercode/protocol': '0.0.0',
      },
    },
    'release-runtime': {
      name: '@piggercode/release-runtime',
    },
    'cli-common': {
      name: '@piggercode/cli-common',
      dependencies: {
        '@piggercode/agents': '0.0.0',
        '@piggercode/release-runtime': '0.0.0',
      },
    },
  };

  for (const [workspaceName, packageJson] of Object.entries(packages)) {
    await mkdir(join(repoRoot, 'packages', workspaceName), { recursive: true });
    await writeJson(join(repoRoot, 'packages', workspaceName, 'package.json'), packageJson);
  }

  const ordered = resolveBundledWorkspaceDependencyBuildOrder({
    repoRoot,
    hostPackageDir: join(repoRoot, 'apps', 'cli'),
  });

  assert.ok(ordered.indexOf('protocol') < ordered.indexOf('agents'));
  assert.ok(ordered.indexOf('agents') < ordered.indexOf('cli-common'));
  assert.ok(ordered.indexOf('release-runtime') < ordered.indexOf('cli-common'));
});

test('resolveWorkspaceDependencyBuildOrder deduplicates shared internal dependencies', async (t) => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'happier-workspace-build-order-dedupe-'));
  t.after(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  const packages = {
    protocol: {
      name: '@piggercode/protocol',
    },
    agents: {
      name: '@piggercode/agents',
      dependencies: {
        '@piggercode/protocol': '0.0.0',
      },
    },
    'release-runtime': {
      name: '@piggercode/release-runtime',
    },
    'cli-common': {
      name: '@piggercode/cli-common',
      dependencies: {
        '@piggercode/agents': '0.0.0',
        '@piggercode/release-runtime': '0.0.0',
      },
    },
  };

  for (const [workspaceName, packageJson] of Object.entries(packages)) {
    await mkdir(join(repoRoot, 'packages', workspaceName), { recursive: true });
    await writeJson(join(repoRoot, 'packages', workspaceName, 'package.json'), packageJson);
  }

  const ordered = resolveWorkspaceDependencyBuildOrder({
    repoRoot,
    seedPackageNames: ['@piggercode/agents', '@piggercode/cli-common'],
  });

  assert.deepEqual(ordered, ['protocol', 'agents', 'release-runtime', 'cli-common']);
});
