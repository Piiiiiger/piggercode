import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseWorkspaceBuildArgs,
  runWorkspacePackageBuild,
} from './ensureWorkspacePackagesBuiltCli.mjs';

test('parses package names and component-owned workspace admission without duplicating either owner', () => {
  assert.deepEqual(
    parseWorkspaceBuildArgs([
      '@piggercode/cli-common',
      '@piggercode/cli-common',
      '--for-component=apps/ui',
    ]),
    {
      packageNames: ['@piggercode/cli-common', '@piggercode/cli-common'],
      componentDirs: ['apps/ui'],
    },
  );
  assert.throws(() => parseWorkspaceBuildArgs(['--for-component=']), /requires a repository-relative path/u);
  assert.throws(() => parseWorkspaceBuildArgs(['--unknown']), /Unknown workspace build option/u);
});

test('delegates de-duplicated requests to the existing workspace build owners', async () => {
  const calls = [];
  const result = await runWorkspacePackageBuild({
    repoRoot: '/repo',
    packageNames: ['@piggercode/cli-common', '@piggercode/cli-common'],
    componentDirs: ['apps/ui', 'apps/ui'],
    ensureWorkspacePackagesBuiltByNameImpl: async (root, names) => {
      calls.push(['packages', root, names]);
      return { ok: true, built: ['cli-common'], skipped: [] };
    },
    ensureWorkspacePackagesBuiltForComponentImpl: async (dir) => {
      calls.push(['component', dir]);
      return { ok: true, built: ['brand'], skipped: [] };
    },
  });

  assert.deepEqual(calls, [
    ['packages', '/repo', ['@piggercode/cli-common']],
    ['component', '/repo/apps/ui'],
  ]);
  assert.deepEqual(result, { ok: true, built: ['cli-common', 'brand'], skipped: [] });
});

test('rejects an empty invocation instead of reporting a vacuous build', async () => {
  await assert.rejects(runWorkspacePackageBuild(), /requires at least one workspace package name or component/u);
});
