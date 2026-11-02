import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += String(d)));
    proc.stderr.on('data', (d) => (stderr += String(d)));
    proc.on('error', reject);
    proc.on('exit', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal: signal ?? null, stdout, stderr }));
  });
}

test('swiftbar plugin renders the configured primary stack header', async (t) => {
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = dirname(scriptsDir);

  const tmp = await mkdtemp(join(tmpdir(), 'hstack-swiftbar-primary-'));
  t.after(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  const stackName = 'repo-foo-1234567890';
  const storageDir = join(tmp, 'stacks');
  const stackDir = join(storageDir, stackName);
  await mkdir(stackDir, { recursive: true });
  await mkdir(join(stackDir, 'cli'), { recursive: true });
  await writeFile(join(stackDir, 'env'), 'PIGGERCODE_STACK_STACK=repo-foo-1234567890\n', 'utf8');

  const plugin = join(rootDir, 'extras', 'swiftbar', 'hstack.5s.sh');
  const res = await run('bash', [plugin], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOME: tmp,
      PIGGERCODE_STACK_SANDBOX_DIR: join(tmp, 'sandbox'),
      PIGGERCODE_STACK_CLI_ROOT_DIR: rootDir,
      PIGGERCODE_STACK_HOME_DIR: join(tmp, 'home'),
      PIGGERCODE_STACK_CANONICAL_HOME_DIR: join(tmp, 'canonical'),
      PIGGERCODE_STACK_STORAGE_DIR: storageDir,
      PIGGERCODE_STACK_SWIFTBAR_PRIMARY_STACK: stackName,
      PIGGERCODE_STACK_ENV_FILE: join(stackDir, 'env'),
      PIGGERCODE_STACK_MENUBAR_MODE: 'selfhost',
    },
  });
  assert.equal(res.code, 0, `expected bash exit 0, got ${res.code}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.ok(res.stdout.includes(`Stack: ${stackName}\n`), `expected primary stack header\nstdout:\n${res.stdout}`);
});

