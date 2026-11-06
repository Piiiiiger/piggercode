import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const { runCommandCaptureMock } = vi.hoisted(() => ({
  runCommandCaptureMock: vi.fn(),
}));

// Only the OS process boundary is replaced; the registry, the installed-CLI resolution (real
// install records) and the task's own rules stay real.
vi.mock('../taskRuntime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../taskRuntime.js')>();
  return {
    ...actual,
    runCommandCapture: runCommandCaptureMock,
  };
});

import { executeSystemTask } from '@piggercode/cli-common/systemTasks';

import { installManagedCliFixture } from '../localHappierCliFixture.js';
import { createHsetupSystemTaskRegistry } from '../registry.js';

type CliCall = Readonly<{ command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }>;

/** The installed CLI answers `--version`; its `self check` exits with `checkStatus`. */
function answerCli(params: Readonly<{ checkStatus: number; checkStderr?: string }>): void {
  runCommandCaptureMock.mockImplementation(async (call: CliCall) => {
    if (call.args[0] === '--version') return { status: 0, stdout: '0.2.13\n', stderr: '' };
    if (call.args[0] === 'self' && call.args[1] === 'check') return { status: params.checkStatus, stdout: '', stderr: params.checkStderr ?? '' };
    throw new Error(`unexpected CLI call: ${call.args.join(' ')}`);
  });
}

async function runCheck(channel: 'stable' | 'preview' = 'stable') {
  return await executeSystemTask({
    // What the desktop app sends (`buildLocalDaemonServiceSystemTaskSpec('cli.check.v1')`).
    spec: { protocolVersion: 1, kind: 'cli.check.v1', params: { target: { kind: 'local' }, surface: 'desktop.ui', mode: 'user', channel } },
    taskId: 'cli-check',
    registry: createHsetupSystemTaskRegistry(),
    emitEvent: () => {},
  });
}

function cliCalls(): string[][] {
  return runCommandCaptureMock.mock.calls.map(([call]) => [(call as CliCall).command, ...(call as CliCall).args]);
}

describe('cli.check.v1: is there a newer command line for this computer?', () => {
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), 'hsetup-cli-check-'));
    vi.stubEnv('PIGGERCODE_HOME_DIR', home);
    vi.stubEnv('PIGGERCODE_BOOTSTRAP_CLI_PATH', '');
    vi.stubEnv('PIGGERCODE_BOOTSTRAP_PIGGERCODE_PATH', '');
    vi.stubEnv('PIGGERCODE_STACK_REPO_DIR', join(home, 'elsewhere'));
    vi.stubEnv('PATH', '');
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('has the CLI the app installed look up its newest release itself, and downloads nothing', async () => {
    const cli = await installManagedCliFixture({ processEnv: process.env });
    answerCli({ checkStatus: 0 });

    const result = await runCheck();

    expect(result).toMatchObject({ ok: true, data: { version: '0.2.13' } });
    expect(cliCalls()).toContainEqual([cli.command, 'self', 'check', '--quiet']);
    // Only the version read and the check: no update, no install, no service command.
    expect(cliCalls().every(([, first]) => first === '--version' || first === 'self')).toBe(true);
    expect(cliCalls().some((call) => call.includes('update'))).toBe(false);
  });

  it('checks the releases of the CLI this computer runs, even when a preview app adopted the stable one', async () => {
    const cli = await installManagedCliFixture({ processEnv: process.env, releaseRing: 'stable' });
    answerCli({ checkStatus: 0 });

    const result = await runCheck('preview');

    expect(result).toMatchObject({ ok: true });
    expect(cliCalls()).toContainEqual([cli.command, 'self', 'check', '--quiet']);
    expect(cliCalls().some((call) => call.includes('--preview'))).toBe(false);
  });

  it('names the ring it checks to the CLI, whatever channel the app\'s own process inherited', async () => {
    await installManagedCliFixture({ processEnv: process.env, releaseRing: 'stable' });
    vi.stubEnv('PIGGERCODE_PUBLIC_RELEASE_CHANNEL', 'preview');
    answerCli({ checkStatus: 0 });

    await runCheck('stable');

    const check = runCommandCaptureMock.mock.calls.map(([call]) => call as CliCall).find((call) => call.args[0] === 'self');
    expect(check?.env?.PIGGERCODE_PUBLIC_RELEASE_CHANNEL).toBe('stable');
  });

  it('reports a check the CLI could not complete as failed', async () => {
    await installManagedCliFixture({ processEnv: process.env });
    answerCli({ checkStatus: 1, checkStderr: 'getaddrinfo ENOTFOUND api.github.com' });

    const result = await runCheck();

    expect(result).toMatchObject({ ok: false, error: { code: 'cli_check_failed' } });
  });

  it('checks nothing on a computer where the app installed no CLI', async () => {
    answerCli({ checkStatus: 0 });

    const result = await runCheck();

    expect(result).toMatchObject({ ok: false, error: { code: 'cli_not_managed' } });
    expect(cliCalls().some((call) => call.includes('check'))).toBe(false);
  });
});
