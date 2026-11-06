import { describe, expect, it } from 'vitest';

import { initialMachineMetadata, refreshMachineMetadataForCurrentDaemon } from './metadata';

describe('initialMachineMetadata', () => {
  it('advertises daemon-owned runtime control capabilities', () => {
    expect(initialMachineMetadata.daemonTerminalSessionAttachSupported).toBe(true);
    expect(initialMachineMetadata.daemonSessionGoalControlsSupported).toBe(true);
  });

  it('refreshes older persisted metadata without dropping user-owned fields', () => {
    const current = {
      ...initialMachineMetadata,
      displayName: 'Build box',
      daemonTerminalSessionAttachSupported: undefined,
      daemonSessionGoalControlsSupported: undefined,
    };

    expect(refreshMachineMetadataForCurrentDaemon(current, current.host)).toMatchObject({
      displayName: 'Build box',
      daemonTerminalSessionAttachSupported: true,
      daemonSessionGoalControlsSupported: true,
    });
  });

  it('returns the existing metadata object when every daemon-owned field is current', () => {
    const current = {
      ...initialMachineMetadata,
      displayName: 'Build box',
    };

    expect(refreshMachineMetadataForCurrentDaemon(current, current.host)).toBe(current);
  });

  it('tells the app whether this machine runs agents: a computer connected through the desktop app does not', () => {
    const previous = process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY;
    try {
      delete process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY;
      const server = refreshMachineMetadataForCurrentDaemon(initialMachineMetadata, initialMachineMetadata.host);
      expect(server.agentsHosted).toBe(true);

      process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY = 'desktop';
      const computer = refreshMachineMetadataForCurrentDaemon(server, server.host);
      expect(computer.agentsHosted).toBe(false);
      expect(refreshMachineMetadataForCurrentDaemon(computer, computer.host)).toBe(computer);
    } finally {
      if (previous === undefined) delete process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY;
      else process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY = previous;
    }
  });

  it('counts the desktop app\'s own install of the default service as a computer that runs no agents', () => {
    const previousManagedBy = process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY;
    const previousBundleId = process.env.PIGGERCODE_DAEMON_SERVICE_BUNDLE_ID;
    try {
      // "Connect this computer" installs the default-following service: it names the app, and only a
      // service for a further relay is also desktop-managed.
      delete process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY;
      process.env.PIGGERCODE_DAEMON_SERVICE_BUNDLE_ID = 'dev.piggercode.app';
      expect(refreshMachineMetadataForCurrentDaemon(initialMachineMetadata, initialMachineMetadata.host).agentsHosted).toBe(false);
    } finally {
      if (previousManagedBy === undefined) delete process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY;
      else process.env.PIGGERCODE_DAEMON_SERVICE_MANAGED_BY = previousManagedBy;
      if (previousBundleId === undefined) delete process.env.PIGGERCODE_DAEMON_SERVICE_BUNDLE_ID;
      else process.env.PIGGERCODE_DAEMON_SERVICE_BUNDLE_ID = previousBundleId;
    }
  });

  it('publishes the daemon\'s CLI update facts (K5) and keeps them when nothing changed', () => {
    const cliUpdate = {
      currentVersion: '0.2.13',
      latestVersion: '0.2.14',
      channel: 'stable' as const,
      installSource: 'managed' as const,
      updateCommand: 'piggercode self update',
      canUpdateRemotely: true,
      lastUpdate: { targetVersion: '0.2.13', outcome: 'succeeded' as const, at: 10, message: null },
    };
    const refreshed = refreshMachineMetadataForCurrentDaemon(initialMachineMetadata, initialMachineMetadata.host, cliUpdate);
    expect(refreshed.cliUpdate).toEqual(cliUpdate);
    expect(refreshMachineMetadataForCurrentDaemon(refreshed, refreshed.host, { ...cliUpdate })).toBe(refreshed);
    expect(refreshMachineMetadataForCurrentDaemon(refreshed, refreshed.host, { ...cliUpdate, latestVersion: '0.2.15' }).cliUpdate?.latestVersion)
      .toBe('0.2.15');
  });
});
