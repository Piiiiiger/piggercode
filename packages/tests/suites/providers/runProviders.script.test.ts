import { describe, expect, it } from 'vitest';

import * as runProvidersScript from '../../scripts/run-providers.mjs';
import { parseArgs, resolveProvidersRunTimeoutFallbackMs, resolveProvidersRunTimeoutMs } from '../../scripts/run-providers.mjs';

type YarnInvocationResolver = (
  args: readonly string[],
  options?: Readonly<{ platform?: NodeJS.Platform; npmExecPath?: string; comspec?: string }>,
) => Readonly<{ command: string; args: string[]; windowsVerbatimArguments?: boolean }>;


describe('providers run script args', () => {

  it('wraps the Windows Yarn shim through cmd.exe', () => {
    const resolveProviderRunYarnInvocation = (runProvidersScript as {
      resolveProviderRunYarnInvocation?: YarnInvocationResolver;
    }).resolveProviderRunYarnInvocation;

    expect(resolveProviderRunYarnInvocation).toBeTypeOf('function');
    if (!resolveProviderRunYarnInvocation) throw new Error('missing provider run Yarn invocation resolver');

    const invocation = resolveProviderRunYarnInvocation(['-s', 'test:providers'], {
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

describe('providers run script timeout', () => {

  it('uses fallback for missing/invalid values', () => {
    expect(resolveProvidersRunTimeoutMs(undefined, 123_000)).toBe(123_000);
    expect(resolveProvidersRunTimeoutMs('0', 123_000)).toBe(123_000);
    expect(resolveProvidersRunTimeoutMs('-50', 123_000)).toBe(123_000);
    expect(resolveProvidersRunTimeoutMs('not-a-number', 123_000)).toBe(123_000);
  });

  it('parses positive values and clamps minimum', () => {
    expect(resolveProvidersRunTimeoutMs('120000', 123_000)).toBe(120_000);
    expect(resolveProvidersRunTimeoutMs('1000', 123_000)).toBe(60_000);
  });
});
