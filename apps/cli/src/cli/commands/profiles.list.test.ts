import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleProfilesCliCommand } from './profiles';
import * as persistenceModule from '@/persistence';
import * as accountSettingsModule from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('piggercode profiles list --json', () => {
  it('lists built-in profiles when unauthenticated', async () => {
    vi.spyOn(persistenceModule, 'readCredentials').mockResolvedValue(null);
    const bootstrapSpy = vi.spyOn(accountSettingsModule, 'bootstrapAccountSettingsContext');
    const output = captureConsoleLogAndMuteStdout();

    await handleProfilesCliCommand({
      args: ['profiles', 'list', '--json'],
      rawArgv: ['happier', 'profiles', 'list', '--json'],
      terminalRuntime: null,
    } as any);

    expect(bootstrapSpy).not.toHaveBeenCalled();

    const stdout = output.logs.join('\n').trim();
    const payload = JSON.parse(stdout) as any;
    expect(payload.ok).toBe(true);
    expect(payload.kind).toBe('profiles_list');
    expect(payload.data?.authenticated).toBe(false);
    expect(payload.data?.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'anthropic', isBuiltIn: true }),
      ]),
    );
  });

  it('includes custom profiles when authenticated', async () => {
    const credentials = {
      token: 'x',
      encryption: { type: 'legacy', secret: new Uint8Array(32) },
    } as any;

    vi.spyOn(persistenceModule, 'readCredentials').mockResolvedValue(credentials);
    const bootstrapSpy = vi.spyOn(accountSettingsModule, 'bootstrapAccountSettingsContext').mockResolvedValue({
      source: 'network',
      settings: {
        profiles: [
          {
            id: 'work',
            name: 'Work',
            compatibilityByTargetKey: { 'agent:claude': true, 'agent:codex': false },
            envVarRequirements: [
              { name: 'WORK_TOKEN', kind: 'secret', required: true },
              { name: 'WORK_HOST', kind: 'config', required: true },
              { name: 'OPTIONAL_SECRET', kind: 'secret', required: false },
            ],
          },
        ],
      },
      settingsVersion: 1,
      loadedAtMs: Date.now(),
      whenRefreshed: null,
    } as any);

    const output = captureConsoleLogAndMuteStdout();

    await handleProfilesCliCommand({
      args: ['profiles', 'list', '--refresh-settings', '--json'],
      rawArgv: ['happier', 'profiles', 'list', '--refresh-settings', '--json'],
      terminalRuntime: null,
    } as any);

    expect(bootstrapSpy).toHaveBeenCalledWith(expect.objectContaining({ refresh: 'force' }));

    const stdout = output.logs.join('\n').trim();
    const payload = JSON.parse(stdout) as any;
    expect(payload.ok).toBe(true);
    expect(payload.kind).toBe('profiles_list');
    expect(payload.data?.authenticated).toBe(true);
    expect(payload.data?.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'work',
          name: 'Work',
          isBuiltIn: false,
          requiredSecretEnvVarNames: ['WORK_TOKEN'],
          requiredConfigEnvVarNames: ['WORK_HOST'],
          supportedAgentIds: expect.arrayContaining(['claude']),
        }),
      ]),
    );

    const work = (payload.data?.profiles as any[]).find((p) => p?.id === 'work');
    expect(work.supportedAgentIds).not.toContain('codex');
  });

  it('includes canonical requiresMachineLoginTargetKey in json output without requiring legacy machine-login fields', async () => {
    const credentials = {
      token: 'x',
      encryption: { type: 'legacy', secret: new Uint8Array(32) },
    } as any;

    vi.spyOn(persistenceModule, 'readCredentials').mockResolvedValue(credentials);
    vi.spyOn(accountSettingsModule, 'bootstrapAccountSettingsContext').mockResolvedValue({
      source: 'network',
      settings: {
        profiles: [
          {
            id: 'codex-login',
            name: 'Codex Login',
            authMode: 'machineLogin',
            compatibilityByTargetKey: { 'agent:codex': true },
            requiresMachineLoginTargetKey: 'agent:codex',
            envVarRequirements: [],
          },
        ],
      },
      settingsVersion: 1,
      loadedAtMs: Date.now(),
      whenRefreshed: null,
    } as any);

    const output = captureConsoleLogAndMuteStdout();

    await handleProfilesCliCommand({
      args: ['profiles', 'list', '--json'],
      rawArgv: ['happier', 'profiles', 'list', '--json'],
      terminalRuntime: null,
    } as any);

    const payload = JSON.parse(output.logs.join('\n').trim()) as any;
    expect(payload.data?.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex-login',
          authMode: 'machineLogin',
          requiresMachineLoginTargetKey: 'agent:codex',
        }),
      ]),
    );
    const codexLogin = (payload.data?.profiles as any[]).find((profile) => profile?.id === 'codex-login');
    expect(codexLogin?.requiresMachineLogin).toBeUndefined();
  });
});
