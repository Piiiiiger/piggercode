import { describe, expect, it } from 'vitest';

import { ConnectedServiceManagementAuthority } from './connectedServiceManagement';

function settingsManagedBy(managingMachineId: string | null, poolsPaused = false) {
  return { connectedServicesManagementV1: { v: 1, managingMachineId, poolsPaused } };
}

describe('ConnectedServiceManagementAuthority', () => {
  it('lets only the managing machine act on subscription logins, and only after the relay confirmed it', () => {
    let settings: unknown = settingsManagedBy('vm');
    const vm = new ConnectedServiceManagementAuthority({ machineId: () => 'vm', readSettings: () => settings });
    const mac = new ConnectedServiceManagementAuthority({ machineId: () => 'mac', readSettings: () => settings });

    // Nothing is confirmed before a settings read on the current connection.
    expect(vm.decide('openai-codex', 'refresh')).toEqual({ allowed: false, reason: 'settings_unconfirmed', managingMachineId: null });
    vm.confirmSettingsRead(vm.beginConnection());
    mac.confirmSettingsRead(mac.beginConnection());

    for (const operation of ['refresh', 'usage', 'launch'] as const) {
      expect(vm.decide('openai-codex', operation)).toEqual({ allowed: true });
      expect(vm.decide('claude-subscription', operation)).toEqual({ allowed: true });
      expect(mac.decide('openai-codex', operation)).toEqual({ allowed: false, reason: 'not_managing_machine', managingMachineId: 'vm' });
    }
    // API keys and tokens of other services are never restricted.
    expect(mac.decide('openai', 'launch')).toEqual({ allowed: true });

    settings = settingsManagedBy(null);
    expect(vm.decide('openai-codex', 'usage')).toEqual({ allowed: false, reason: 'no_managing_machine', managingMachineId: null });

    settings = settingsManagedBy('vm', true);
    expect(vm.decide('openai-codex', 'launch')).toEqual({ allowed: false, reason: 'pools_paused', managingMachineId: 'vm' });
    expect(vm.decide('openai-codex', 'refresh')).toEqual({ allowed: true });
  });

  it('refuses again after a reconnect until settings are read on the new connection', () => {
    const authority = new ConnectedServiceManagementAuthority({ machineId: () => 'vm', readSettings: () => settingsManagedBy('vm') });
    const first = authority.beginConnection();
    authority.confirmSettingsRead(first);
    expect(authority.decide('openai-codex', 'refresh')).toEqual({ allowed: true });

    const second = authority.beginConnection();
    expect(authority.decide('openai-codex', 'refresh')).toEqual({ allowed: false, reason: 'settings_unconfirmed', managingMachineId: null });
    // A read that completes for an older connection does not confirm the current one.
    expect(authority.confirmSettingsRead(first)).toBe(false);
    expect(authority.decide('openai-codex', 'refresh').allowed).toBe(false);
    expect(authority.confirmSettingsRead(second)).toBe(true);
    expect(authority.decide('openai-codex', 'refresh')).toEqual({ allowed: true });
  });

  it('confirms from a relay read on connect and retries a failed read after the backoff', async () => {
    let nowMs = 0;
    const reads: Array<{ resolve: (value: { outdatedMachines: string[] }) => void; reject: (error: Error) => void }> = [];
    const authority = new ConnectedServiceManagementAuthority({
      machineId: () => 'vm',
      readSettings: () => settingsManagedBy('vm'),
      readSettingsFromRelay: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
      retryDelayMs: () => 30_000,
      now: () => nowMs,
    });
    const settle = async (outcome: { outdatedMachines: string[] } | Error) => {
      const read = reads.shift();
      if (outcome instanceof Error) read?.reject(outcome);
      else read?.resolve(outcome);
      await new Promise((resolve) => setImmediate(resolve));
    };

    authority.beginConnection();
    expect(reads).toHaveLength(1);
    expect(authority.decide('openai-codex', 'usage').allowed).toBe(false);
    expect(reads).toHaveLength(1); // one read in flight at a time

    await settle(new Error('relay unreachable'));
    expect(authority.decide('openai-codex', 'usage').allowed).toBe(false);
    expect(reads).toHaveLength(0); // waits for the backoff
    nowMs = 30_000;
    expect(authority.decide('openai-codex', 'usage').allowed).toBe(false);
    expect(reads).toHaveLength(1);

    await settle({ outdatedMachines: [] });
    expect(authority.decide('openai-codex', 'usage')).toEqual({ allowed: true });
  });

  it('refuses launches, but not refresh or usage, while a known machine runs an older CLI', async () => {
    let nowMs = 0;
    const reads: Array<(value: { outdatedMachines: string[] }) => void> = [];
    const authority = new ConnectedServiceManagementAuthority({
      machineId: () => 'vm',
      readSettings: () => settingsManagedBy('vm'),
      readSettingsFromRelay: () => new Promise((resolve) => reads.push(resolve)),
      retryDelayMs: () => 30_000,
      now: () => nowMs,
    });
    authority.beginConnection();
    reads.shift()?.({ outdatedMachines: ['old-laptop'] });
    await new Promise((resolve) => setImmediate(resolve));

    expect(authority.decide('openai-codex', 'refresh')).toEqual({ allowed: true });
    expect(authority.decide('openai-codex', 'usage')).toEqual({ allowed: true });
    expect(authority.decide('openai-codex', 'launch')).toEqual({
      allowed: false, reason: 'outdated_machines', managingMachineId: 'vm', outdatedMachines: ['old-laptop'],
    });

    // Once that machine is updated, the next read (after the backoff) lets launches through.
    nowMs = 30_000;
    authority.decide('openai-codex', 'launch');
    expect(reads).toHaveLength(1);
    reads.shift()?.({ outdatedMachines: [] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(authority.decide('openai-codex', 'launch')).toEqual({ allowed: true });
  });

  it('does no subscription-login work while the daemon runs without its refresh owner', async () => {
    let refreshOwnerRunning = false;
    const authority = new ConnectedServiceManagementAuthority({
      machineId: () => 'vm',
      readSettings: () => ({ connectedServicesManagementV1: { v: 1, managingMachineId: 'vm', poolsPaused: false } }),
      refreshOwnerRunning: () => refreshOwnerRunning,
    });
    authority.confirmSettingsRead(authority.beginConnection());
    // A terminal reattached after a restart must not have its login renewed or its usage polled either:
    // no read-back would follow its rotations.
    await expect(authority.decideLaunch('openai-codex'))
      .resolves.toMatchObject({ allowed: false, reason: 'refresh_owner_unavailable' });
    expect(authority.decide('openai-codex', 'refresh')).toMatchObject({ allowed: false, reason: 'refresh_owner_unavailable' });
    expect(authority.decide('claude-subscription', 'usage')).toMatchObject({ allowed: false, reason: 'refresh_owner_unavailable' });
    // API keys are not subscription logins.
    expect(authority.decide('anthropic', 'usage')).toEqual({ allowed: true });
    refreshOwnerRunning = true;
    await expect(authority.decideLaunch('openai-codex')).resolves.toEqual({ allowed: true });
    expect(authority.decide('claude-subscription', 'usage')).toEqual({ allowed: true });
  });
});
