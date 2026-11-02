import { describe, expect, it } from 'vitest';

import { buildBackgroundServiceRepairPlan } from './buildBackgroundServiceRepairPlan';

describe('buildBackgroundServiceRepairPlan', () => {
  it('migrates only the current-server pinned current-channel service to one default background service', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentServerId: 'company',
      preferredMode: 'user',
      services: [{
        serverId: 'company',
        name: 'Company',
        installed: true,
        path: '/tmp/piggercode-daemon.preview.company.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.company',
        targetMode: 'pinned',
      }, {
        serverId: 'sidecar',
        name: 'Sidecar',
        installed: true,
        path: '/tmp/piggercode-daemon.preview.sidecar.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.sidecar',
        targetMode: 'pinned',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.preview.company',
          mode: 'user',
          targetMode: 'pinned',
          releaseChannel: 'preview',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('keeps one compatible default background service without removing unrelated pinned services', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'stable',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: '/tmp/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }, {
        serverId: 'company',
        name: 'Company',
        installed: true,
        path: '/tmp/piggercode-daemon.company.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.company',
        targetMode: 'pinned',
      }],
    });

    expect(plan.actions).toEqual([]);
  });

  it('reinstalls the compatible default service when its definition does not match the expected contents', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'stable',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: '/tmp/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
        installedDefinitionMatchesExpected: false,
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'stable',
        mode: 'user',
      }),
    ]);
  });

  it('keeps same-home pinned services of other relays while removing pinned services of the current relay', () => {
    const home = '/home/test/.piggercode';
    const unitDir = '/home/test/.config/systemd/user';
    const pinned = (serverId: string, relayUrl: string | null, releaseChannel: 'stable' | 'preview') => ({
      serverId,
      activeServerId: serverId,
      name: serverId,
      relayUrl,
      installed: true,
      path: `${unitDir}/piggercode-daemon.${serverId}.service`,
      platform: 'linux' as const,
      mode: 'user' as const,
      happierHomeDir: home,
      releaseChannel,
      label: `piggercode-daemon.${serverId}`,
      targetMode: 'pinned' as const,
    });
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: home,
      currentServerId: 'cloud',
      currentServerUrl: 'https://api.happier.dev',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: `${unitDir}/piggercode-daemon.default.service`,
        platform: 'linux',
        mode: 'user',
        happierHomeDir: home,
        releaseChannel: 'preview',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      },
      // The 0.2.3 migration's target: a legacy unit pinned to the relay the default service serves.
      pinned('cloud', 'https://api.happier.dev', 'stable'),
      // The same relay under another profile id still duplicates the default service.
      pinned('cloud-alias', 'https://API.happier.dev/', 'preview'),
      // "Connect to this relay too": this computer's own service for another relay.
      pinned('company', 'https://company.example.test', 'preview'),
      pinned('personal', 'https://personal.example.test', 'stable')],
    });

    const removedLabels = plan.actions.flatMap((action) => action.kind === 'remove-service' ? [action.service.label] : []);
    expect(removedLabels.sort()).toEqual(['piggercode-daemon.cloud', 'piggercode-daemon.cloud-alias']);
    expect(plan.actions.every((action) => action.kind === 'remove-service')).toBe(true);
  });

  it('keeps the preferred-mode compatible default service and removes the duplicate from the other mode', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'stable',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }, {
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: '/etc/systemd/system/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'system',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.default',
          mode: 'system',
          targetMode: 'default-following',
          releaseChannel: 'stable',
        }),
      }),
    ]);
  });

  it('prefers the canonical default service when same-mode compatible duplicates exist', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default-copy',
        name: 'Default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default-copy.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.default-copy',
        targetMode: 'default-following',
      }, {
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.default-copy',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'preview',
        }),
      }),
    ]);
  });

  it('keeps the unscoped canonical default service over legacy channel-scoped default units', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Legacy preview default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.preview.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.default',
        targetMode: 'default-following',
      }, {
        serverId: 'default',
        name: 'Canonical default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.preview.default',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'preview',
        }),
      }),
    ]);
  });

  it('migrates a raw legacy daemon service to the canonical default service', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Legacy default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'happier-daemon',
        targetMode: 'default-following',
        installedDefinitionMatchesExpected: false,
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'happier-daemon',
          installedPath: '/home/test/.config/systemd/user/piggercode-daemon.service',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'preview',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('migrates a stale default-following service from another release channel to the current default service', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'stack-a',
      preferredMode: 'user',
      services: [{
        serverId: 'stack-a',
        name: 'Preview background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.default',
          installedPath: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'stable',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('repairs a foreign-home default service while migrating current-server pinned services', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'stack-a',
      preferredMode: 'user',
      services: [{
        serverId: 'stack-a',
        name: 'Pinned current server',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.preview.stack-a.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.stack-a',
        targetMode: 'pinned',
      }, {
        serverId: 'default',
        name: 'Foreign default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/other/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.manualWarnings).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.default',
          installedPath: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'preview',
        }),
      }),
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.preview.stack-a',
          mode: 'user',
          targetMode: 'pinned',
          releaseChannel: 'preview',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('repairs a same-mode default-following service from another PiggerCode home', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Foreign stale default background service',
        installed: true,
        path: '/Users/tester/Library/LaunchAgents/com.piggercode.cli.daemon.default.plist',
        platform: 'darwin',
        mode: 'user',
        happierHomeDir: '/Users/tester/.piggercode/stacks/repo-dev-old/cli',
        releaseChannel: 'stable',
        label: 'com.piggercode.cli.daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.manualWarnings).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'com.piggercode.cli.daemon.default',
          installedPath: '/Users/tester/Library/LaunchAgents/com.piggercode.cli.daemon.default.plist',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'stable',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('repairs a same-mode default-following service with missing PiggerCode home metadata', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Legacy default background service',
        installed: true,
        path: '/Users/tester/Library/LaunchAgents/com.piggercode.cli.daemon.default.plist',
        platform: 'darwin',
        mode: 'user',
        releaseChannel: 'stable',
        label: 'com.piggercode.cli.daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.manualWarnings).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'com.piggercode.cli.daemon.default',
          installedPath: '/Users/tester/Library/LaunchAgents/com.piggercode.cli.daemon.default.plist',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'stable',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('does not remove or replace services from another PiggerCode home when a foreign pinned service targets the current server', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'stack-a',
      preferredMode: 'user',
      services: [{
        serverId: 'stack-a',
        name: 'Pinned current server',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.preview.stack-a.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.stack-a',
        targetMode: 'pinned',
      }, {
        serverId: 'stack-a',
        name: 'Foreign pinned current server',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.preview.stack-a.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/other/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.stack-a',
        targetMode: 'pinned',
      }],
    });

    expect(plan.actions).toEqual([]);
    expect(plan.manualWarnings).toEqual([
      expect.stringContaining('/home/other/.piggercode'),
    ]);
  });

  it('removes same-mode default-following services with unknown PiggerCode home metadata when a compatible default exists', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Canonical default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        happierHomeDir: '/home/test/.piggercode',
        releaseChannel: 'preview',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }, {
        serverId: 'default',
        name: 'Legacy preview default background service (missing home)',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.preview.default.service',
        platform: 'linux',
        mode: 'user',
        // happierHomeDir intentionally omitted (legacy services may not embed it)
        releaseChannel: 'preview',
        label: 'piggercode-daemon.preview.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.manualWarnings).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.preview.default',
          installedPath: '/home/test/.config/systemd/user/piggercode-daemon.preview.default.service',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'preview',
        }),
      }),
    ]);
  });

  it('repairs default-following services with missing PiggerCode home metadata from another release channel', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentHappierHomeDir: '/home/test/.piggercode',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Legacy stable default background service (missing home)',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.manualWarnings).toEqual([]);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.default',
          installedPath: '/home/test/.config/systemd/user/piggercode-daemon.default.service',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'stable',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('migrates a stale pinned service for the current server from another release channel to the current default service', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentServerId: 'stack-a',
      preferredMode: 'user',
      services: [{
        serverId: 'stack-a',
        name: 'Stack A',
        installed: true,
        path: '/home/test/.config/systemd/user/piggercode-daemon.preview.stack-a.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'stable',
        label: 'piggercode-daemon.preview.stack-a',
        targetMode: 'pinned',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'piggercode-daemon.preview.stack-a',
          mode: 'user',
          targetMode: 'pinned',
          releaseChannel: 'stable',
        }),
      }),
      expect.objectContaining({
        kind: 'install-default-following-service',
        releaseChannel: 'preview',
        mode: 'user',
      }),
    ]);
  });

  it('keeps the canonical Windows default service over legacy channel-scoped task-name and wrapper-path forms', () => {
    const plan = buildBackgroundServiceRepairPlan({
      currentReleaseChannel: 'preview',
      currentServerId: 'default',
      preferredMode: 'user',
      services: [{
        serverId: 'default',
        name: 'Legacy preview default background service',
        installed: true,
        path: 'C:\\Users\\tester\\.piggercode\\services\\piggercode-daemon.preview.default.ps1',
        platform: 'win32',
        mode: 'user',
        happierHomeDir: 'C:\\Users\\tester\\.piggercode',
        releaseChannel: 'preview',
        label: 'PiggerCode\\piggercode-daemon.preview.default',
        targetMode: 'default-following',
      }, {
        serverId: 'default',
        name: 'Canonical default background service',
        installed: true,
        path: 'C:\\Users\\tester\\.piggercode\\services\\piggercode-daemon.default.ps1',
        platform: 'win32',
        mode: 'user',
        happierHomeDir: 'C:\\Users\\tester\\.piggercode',
        releaseChannel: 'preview',
        label: 'PiggerCode\\piggercode-daemon.default',
        targetMode: 'default-following',
      }],
    });

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'remove-service',
        service: expect.objectContaining({
          label: 'PiggerCode\\piggercode-daemon.preview.default',
          mode: 'user',
          targetMode: 'default-following',
          releaseChannel: 'preview',
        }),
      }),
    ]);
  });
});
