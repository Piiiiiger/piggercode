import { afterEach, describe, expect, it, vi } from 'vitest';

import { partitionProviderSessionArgs } from './providerSessionArgPartition';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('partitionProviderSessionArgs', () => {

  it('consumes --native-terminal as a session flag instead of passing it to the provider', () => {
    const result = partitionProviderSessionArgs({
      args: ['claude', '--started-by', 'daemon', '--native-terminal', '--resume', 'abc'],
      providerSubcommand: 'claude',
      forwardResumeFlag: true,
    });

    expect(result).toMatchObject({ startedBy: 'daemon', nativeTerminal: true, resume: 'abc' });
    expect(result.providerArgs).toEqual(['--resume', 'abc']);
  });

  it('consumes common PiggerCode session flags and preserves provider args', () => {
    const result = partitionProviderSessionArgs({
      args: [
        'codex',
        '--profile',
        'work',
        '--permission-mode',
        'yolo',
        '--happy-starting-mode',
        'remote',
        'resume',
        '--all',
      ],
      providerSubcommand: 'codex',
    });

    expect(result).toMatchObject({
      profileQuery: 'work',
      permissionMode: 'yolo',
      startingMode: 'remote',
      providerArgs: ['resume', '--all'],
    });
  });

  it('can consume provider-owned directory aliases without forwarding them', () => {
    const result = partitionProviderSessionArgs({
      args: ['codex', '-C', '/tmp/a', '--cd', '/tmp/b', 'fix this'],
      providerSubcommand: 'codex',
      directoryFlags: ['-C', '--cd'],
    });

    expect(result.directory).toBe('/tmp/b');
    expect(result.providerArgs).toEqual(['fix this']);
  });

  it('can forward consumed model flags to providers that also own model selection', () => {
    const result = partitionProviderSessionArgs({
      args: ['claude', '--model', 'opus', '--fallback-model', 'sonnet', 'fix this'],
      providerSubcommand: 'claude',
      forwardModelFlag: true,
    });

    expect(result.modelId).toBe('opus');
    expect(result.providerArgs).toEqual(['--model', 'opus', '--fallback-model', 'sonnet', 'fix this']);
  });

  it('maps --yolo to provider args when a provider supplies an alias', () => {
    const result = partitionProviderSessionArgs({
      args: ['claude', '--yolo', 'fix this'],
      providerSubcommand: 'claude',
      yoloProviderArgs: ['--dangerously-skip-permissions'],
    });

    expect(result.permissionMode).toBe('yolo');
    expect(result.providerArgs).toEqual(['--dangerously-skip-permissions', 'fix this']);
  });

  it('preserves provider resume flags when requested while exposing the PiggerCode resume value', () => {
    const result = partitionProviderSessionArgs({
      args: ['claude', '--resume', 'abc123', '--continue'],
      providerSubcommand: 'claude',
      forwardResumeFlag: true,
    });

    expect(result.resume).toBe('abc123');
    expect(result.providerArgs).toEqual(['--resume', 'abc123', '--continue']);
  });

  it('preserves provider-specific permission mode tokens', () => {
    const result = partitionProviderSessionArgs({
      args: ['claude', '--permission-mode=bypassPermissions'],
      providerSubcommand: 'claude',
    });

    expect(result.permissionMode).toBe('bypassPermissions');
    expect(result.providerArgs).toEqual([]);
  });

  it('recognizes Codex native -V as a provider version request', () => {
    const result = partitionProviderSessionArgs({
      args: ['codex', '-V'],
      providerSubcommand: 'codex',
      versionFlags: ['-v', '-V', '--version'],
    });

    expect(result.versionRequested).toBe(true);
    expect(result.providerArgs).toEqual([]);
  });

  it('does not treat provider-specific -V as a common PiggerCode version flag', () => {
    const result = partitionProviderSessionArgs({
      args: ['claude', '-V'],
      providerSubcommand: 'claude',
    });

    expect(result.versionRequested).toBe(false);
    expect(result.providerArgs).toEqual(['-V']);
  });

  it('preserves provider subcommand context around help requests', () => {
    const result = partitionProviderSessionArgs({
      args: ['codex', 'exec', '--help'],
      providerSubcommand: 'codex',
    });

    expect(result.helpRequested).toBe(true);
    expect(result.providerArgs).toEqual(['exec']);
  });

  it('rejects option-like values for required PiggerCode-owned flags', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
      throw new Error(`exit:${code ?? 0}`);
    });

    expect(() => {
      partitionProviderSessionArgs({
        args: ['codex', '--model', '--help'],
        providerSubcommand: 'codex',
        forwardModelFlag: true,
      });
    }).toThrow('exit:1');
  });

  it('consumes numeric account settings version hints without forwarding them', () => {
    const result = partitionProviderSessionArgs({
      args: ['codex', '--account-settings-version-hint', '-1', 'exec', '--json'],
      providerSubcommand: 'codex',
    });

    expect(result.providerArgs).toEqual(['exec', '--json']);
  });

  it('separates launch profile and auth selection from provider-native arguments', () => {
    const result = partitionProviderSessionArgs({
      args: [
        'codex',
        '--launch-profile', 'work',
        '--auth', 'cs:group:happier',
        'exec',
      ],
      providerSubcommand: 'codex',
    });

    expect(result).toMatchObject({
      profileQuery: 'work',
      connectedServicesAuthRaw: 'cs:group:happier',
      providerArgs: ['exec'],
    });
  });

  it('rejects competing auth shorthand and JSON power inputs', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
      throw new Error(`exit:${code ?? 0}`);
    });
    expect(() => partitionProviderSessionArgs({
      args: ['codex', '--auth', 'native', '--auth-json', '{"v":1,"bindingsByServiceId":{}}'],
      providerSubcommand: 'codex',
    })).toThrow('exit:1');
  });
});
