import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { ROOT_TYPECHECK_COMMANDS, runRootTypecheck } from './runTypecheck.ts';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

for (const [lane, expectedCommands] of Object.entries({
  unit: [
    ['-s', 'test:shared-packages:local'],
    ['workspace', '@piggercode/app', 'test'],
    ['workspace', '@piggercode/cli', 'test:unit'],
    ['--cwd', 'apps/server', 'test:unit'],
    ['--cwd', 'apps/stack', 'test:unit'],
  ],
  integration: [
    ['workspace', '@piggercode/app', 'test:integration'],
    ['workspace', '@piggercode/cli', 'test:integration'],
    ['--cwd', 'apps/server', 'test:integration'],
    ['--cwd', 'apps/stack', 'test:integration'],
  ],
})) {
  test(`root ${lane} command runs every workspace after failures and exits nonzero`, () => {
    const fixture = mkdtempSync(join(tmpdir(), 'happier-root-tests-'));
    try {
      const log = join(fixture, 'calls.jsonl');
      const yarn = join(fixture, 'yarn.cjs');
      // Mock only the external package-manager process, retaining the real root orchestration.
      writeFileSync(yarn, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.ROOT_TEST_CALLS, JSON.stringify(args) + '\\n');\nprocess.exit(args.includes('apps/stack') ? 0 : 1);\n`, { mode: 0o755 });
      if (process.platform === 'win32') {
        writeFileSync(join(fixture, 'yarn.cmd'), `@"${process.execPath}" "${yarn}" %*\r\n`);
      } else {
        writeFileSync(join(fixture, 'yarn'), readFileSync(yarn), { mode: 0o755 });
      }
      const result = spawnSync(rootPackage.scripts?.[`test:${lane}`] ?? '', {
        shell: true,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fixture}${delimiter}${process.env.PATH}`, npm_execpath: yarn, ROOT_TEST_CALLS: log },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)), expectedCommands);
      assert.match(result.stderr, /Root .* test suite failures:/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test('root typecheck script delegates workspace ownership to the all-settled runner', () => {
  assert.equal(
    rootPackage.scripts?.['typecheck:inner'],
    'node --experimental-strip-types scripts/testing/runTypecheck.ts',
  );
  assert.equal(
    rootPackage.scripts?.typecheck,
    'node scripts/runWithHeartbeat.mjs --label typecheck -- yarn -s typecheck:inner',
  );
});

test('root typecheck inventory preserves every existing workspace owner', () => {
  assert.deepEqual(ROOT_TYPECHECK_COMMANDS.map((command) => command.args), [
    ['workspace', 'privacy-kit', 'typecheck'],
    ['workspace', '@piggercode/protocol', 'typecheck'],
    ['workspace', '@piggercode/transfers', 'typecheck'],
    ['workspace', '@piggercode/agents', 'typecheck'],
    ['workspace', '@piggercode/cli-common', 'typecheck'],
    ['workspace', '@piggercode/connection-supervisor', 'typecheck'],
    ['workspace', '@piggercode/bootstrap', 'typecheck'],
    ['workspace', '@piggercode/app', 'typecheck'],
    ['workspace', '@piggercode/cli', 'typecheck'],
    ['--cwd', 'apps/server', 'typecheck'],
    ['workspace', '@piggercode/tests', 'typecheck'],
  ]);
});

test('root typecheck attempts later workspaces after failures and reports the complete failure set', async () => {
  const executed: string[] = [];
  let active = 0;
  let maximumActive = 0;

  await assert.rejects(
    runRootTypecheck({
      commands: [
        { id: 'ui', args: ['workspace', '@piggercode/app', 'typecheck'] },
        { id: 'cli', args: ['workspace', '@piggercode/cli', 'typecheck'] },
        { id: 'server', args: ['--cwd', 'apps/server', 'typecheck'] },
      ],
      runCommand: async (command) => {
        executed.push(command.id);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolveRun) => setImmediate(resolveRun));
        active -= 1;
        if (command.id !== 'server') throw new Error(`${command.id} failed`);
      },
    }),
    (error: unknown) => {
      assert.match(String(error), /ui: ui failed/u);
      assert.match(String(error), /cli: cli failed/u);
      return true;
    },
  );

  assert.deepEqual(executed, ['ui', 'cli', 'server']);
  assert.equal(maximumActive, 1);
});

test('root import-cycle command delegates to the CLI guard', () => {
  assert.equal(
    rootPackage.scripts?.['test:import-cycles'],
    'yarn workspace @piggercode/cli test:import-cycles',
  );
});

test('root provider aliases expose Cursor smoke and extended presets', () => {
  assert.equal(
    rootPackage.scripts?.['test:providers:cursor:smoke'],
    'yarn workspace @piggercode/tests providers:cursor:smoke',
  );
  assert.equal(
    rootPackage.scripts?.['test:providers:cursor:extended'],
    'yarn workspace @piggercode/tests providers:cursor:extended',
  );
});
