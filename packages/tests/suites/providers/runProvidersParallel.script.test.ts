import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import * as runProvidersParallelScript from '../../scripts/run-providers-parallel.mjs';
import {
  parseArgs,
  resolveRetryScenarioIds,
  parseFailureReportJson,
  filterProviderIdsByScenarioRegistry,
  buildProviderChildEnv,
  mergeTokenLedgersFromPaths,
} from '../../scripts/run-providers-parallel.mjs';

type YarnInvocationResolver = (
  args: readonly string[],
  options?: Readonly<{ platform?: NodeJS.Platform; npmExecPath?: string; comspec?: string }>,
) => Readonly<{ command: string; args: string[]; windowsVerbatimArguments?: boolean }>;

describe('providers parallel run script args', () => {
  it('defaults flake retry to enabled', () => {
    const parsed = parseArgs(['node', 'run-providers-parallel.mjs', 'all', 'extended']);

    expect(parsed.flakeRetry).toBe(true);
  });

  it('parses retry options and flags', () => {
    const parsed = parseArgs([
      'node',
      'run-providers-parallel.mjs',
      'all',
      'extended',
      '--max-parallel',
      '5',
      '--update-baselines',
      '--strict-keys',
      '--flake-retry',
    ]);

    expect(parsed).toEqual({
      presetId: 'all',
      tier: 'extended',
      maxParallelRaw: '5',
      retrySerial: true,
      updateBaselines: true,
      strictKeys: true,
      flakeRetry: true,
    });
  });

  it('allows explicit flake retry opt-out', () => {
    const parsed = parseArgs(['node', 'run-providers-parallel.mjs', 'all', 'extended', '--no-flake-retry']);

    expect(parsed.flakeRetry).toBe(false);
  });

  it('disables serial retry with --no-retry-serial', () => {
    const parsed = parseArgs([
      'node',
      'run-providers-parallel.mjs',
      'all',
      'extended',
      '--no-retry-serial',
    ]);

    expect(parsed.retrySerial).toBe(false);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['node', 'run-providers-parallel.mjs', 'all', 'extended', '--bad-flag'])).toThrow(
      /Unknown flag/,
    );
  });

  it('rejects conflicting flake retry flags', () => {
    expect(() =>
      parseArgs([
        'node',
        'run-providers-parallel.mjs',
        'all',
        'extended',
        '--flake-retry',
        '--no-flake-retry',
      ]),
    ).toThrow(/Conflicting flags/);
  });

  it('wraps the Windows Yarn shim through cmd.exe', () => {
    const resolveProviderRunYarnInvocation = (runProvidersParallelScript as {
      resolveProviderRunYarnInvocation?: YarnInvocationResolver;
    }).resolveProviderRunYarnInvocation;

    expect(resolveProviderRunYarnInvocation).toBeTypeOf('function');
    if (!resolveProviderRunYarnInvocation) throw new Error('missing provider run Yarn invocation resolver');

    const invocation = resolveProviderRunYarnInvocation(['-s', 'workspace', '@piggercode/server', 'generate:providers'], {
      platform: 'win32',
      npmExecPath: 'C:\\npm\\node_modules\\npm\\bin\\npm-cli.js',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(invocation.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(invocation.windowsVerbatimArguments).toBe(true);
    expect(invocation.args.join(' ')).toContain('yarn.cmd');
    expect(invocation.args.join(' ')).not.toContain('npm-cli.js');
  });
});

describe('providers parallel retry selection', () => {
  it('reruns from the failed scenario to the end of the ordered tier list', () => {
    const retryIds = resolveRetryScenarioIds({
      orderedScenarioIds: ['a', 'b', 'c', 'd'],
      failedScenarioId: 'b',
    });
    expect(retryIds).toEqual(['b', 'c', 'd']);
  });

  it('returns null when failed scenario is absent from ordered list', () => {
    const retryIds = resolveRetryScenarioIds({
      orderedScenarioIds: ['a', 'b', 'c'],
      failedScenarioId: 'x',
    });
    expect(retryIds).toBeNull();
  });
});

describe('providers parallel child env defaults', () => {
  it('disables preflight CLI dist rebuilds by default to avoid parallel build churn', () => {
    const env = buildProviderChildEnv({
      baseEnv: {},
      reportPath: '/tmp/failure-report.json',
      scenarioIds: null,
      tokenLedgerPath: null,
    });

    expect(env.PIGGERCODE_E2E_PROVIDER_ALLOW_CLI_PREBUILD_REBUILD).toBe('0');
    expect(env.HAPPY_E2E_PROVIDER_ALLOW_CLI_PREBUILD_REBUILD).toBe('0');
    expect(env.PIGGERCODE_E2E_PROVIDER_SKIP_SERVER_GENERATE).toBe('1');
    expect(env.HAPPY_E2E_PROVIDER_SKIP_SERVER_GENERATE).toBe('1');
  });

  it('forwards explicit scenario selection into child env', () => {
    const env = buildProviderChildEnv({
      baseEnv: {},
      reportPath: '/tmp/failure-report.json',
      scenarioIds: ['read_known_file', 'search_known_token'],
      tokenLedgerPath: null,
    });

    expect(env.PIGGERCODE_E2E_PROVIDER_SCENARIOS).toBe('read_known_file,search_known_token');
    expect(env.HAPPY_E2E_PROVIDER_SCENARIOS).toBe('read_known_file,search_known_token');
  });

  it('forwards token ledger path into child env when provided', () => {
    const env = buildProviderChildEnv({
      baseEnv: {},
      reportPath: '/tmp/failure-report.json',
      scenarioIds: null,
      tokenLedgerPath: '/tmp/provider-token-ledger.codex.json',
    });

    expect(env.PIGGERCODE_E2E_PROVIDER_TOKEN_LEDGER_PATH).toBe('/tmp/provider-token-ledger.codex.json');
    expect(env.HAPPY_E2E_PROVIDER_TOKEN_LEDGER_PATH).toBe('/tmp/provider-token-ledger.codex.json');
  });
});
