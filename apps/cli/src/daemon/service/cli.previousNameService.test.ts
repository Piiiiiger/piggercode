import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withConfiguredDaemonTestHome, writeDaemonSettingsFixture } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
import { mockCurrentProcessAsDaemonLifecycleOwner } from '@/testkit/process/daemonLifecycleOwner';
import type { DaemonLocallyPersistedState } from '@/persistence';

import { planDaemonServiceInstall } from './plan';

afterEach(() => {
  vi.doUnmock('node:child_process');
  vi.doUnmock('@/daemon/doctor');
  vi.doUnmock('./commandExistsInPath');
  vi.resetModules();
});

const RELAY = { id: 'relay', name: 'Relay', serverUrl: 'http://127.0.0.1:43290', webappUrl: 'http://127.0.0.1:43290' };

const SERVICE_ENV = {
  PIGGERCODE_DAEMON_SERVICE_UID: '501',
  PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
  PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
  PIGGERCODE_DAEMON_SERVICE_NODE_PATH: process.execPath,
  PIGGERCODE_DAEMON_SERVICE_ENTRY_PATH: join(process.cwd(), 'src/index.ts'),
  PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
  PIGGERCODE_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '250',
  PIGGERCODE_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
  PIGGERCODE_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
} as const;

/** The unit the Happier-named CLI 0.2.17 wrote on an upgraded machine; only its paths are substituted. */
function renderHappierNamedLinuxUnit(declaredHomeDir: string): string {
  return `[Unit]
Description=Happier CLI daemon (default)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h
KillMode=process
ManagedOOMPreference=avoid

Environment=PATH=${declaredHomeDir}/tools/js-runtime/current/bin:/usr/local/bin:/usr/bin:/bin
Environment=HAPPIER_HOME_DIR=${declaredHomeDir}
Environment=HAPPIER_PUBLIC_RELEASE_CHANNEL=stable
Environment=HAPPIER_DAEMON_STARTUP_SOURCE=background-service
Environment=HAPPIER_DAEMON_SERVICE_LABEL=com.happier.cli.daemon.default
Environment=HAPPIER_DAEMON_SERVICE_TARGET_MODE=default-following
Environment=HAPPIER_DAEMON_SERVICE_AUTOSTART=at-login
Environment=HAPPIER_NO_BROWSER_OPEN=1
Environment=HAPPIER_DAEMON_WAIT_FOR_AUTH=1
Environment=HAPPIER_DAEMON_WAIT_FOR_AUTH_TIMEOUT_MS=0
ExecStart=${declaredHomeDir}/tools/js-runtime/current/bin/happier-js-runtime ${declaredHomeDir}/cli/versions/0.2.17/package-dist/index.mjs daemon start-sync --takeover
Restart=on-failure
RestartSec=2
[Install]
WantedBy=default.target
`;
}

/** The LaunchAgent the Happier-named CLI wrote: the rename changed only these names in it. */
function renderHappierNamedLaunchAgent(userHomeDir: string, declaredHomeDir: string): string {
  const plan = planDaemonServiceInstall({
    platform: 'darwin', channel: 'stable', targetMode: 'default-following', autostart: 'at-login',
    instanceId: RELAY.id, userHomeDir, happierHomeDir: declaredHomeDir, uid: 501,
    serverUrl: RELAY.serverUrl, webappUrl: RELAY.webappUrl, publicServerUrl: RELAY.serverUrl,
    nodePath: process.execPath, entryPath: join(declaredHomeDir, 'cli/versions/0.2.17/package-dist/index.mjs'),
  });
  return plan.files[0]!.content
    .replaceAll('com.piggercode.cli.daemon', 'com.happier.cli.daemon')
    .replaceAll('PIGGERCODE_', 'HAPPIER_');
}

const PLATFORMS = {
  linux: {
    oldDefinition: (home: string) => join(home, '.config/systemd/user/happier-daemon.default.service'),
    newDefinition: (home: string) => join(home, '.config/systemd/user/piggercode-daemon.default.service'),
    renderOld: (_home: string, declaredHomeDir: string) => renderHappierNamedLinuxUnit(declaredHomeDir),
    stopsOld: (command: string, args: readonly string[]) =>
      command === 'systemctl' && args.join(' ') === '--user disable --now happier-daemon.default.service',
    startsNew: (command: string, args: readonly string[]) =>
      command === 'systemctl' && args.join(' ') === '--user restart piggercode-daemon.default.service',
    mentionsOld: (_command: string, args: readonly string[]) => args.some((arg) => arg.includes('happier-daemon')),
  },
  darwin: {
    oldDefinition: (home: string) => join(home, 'Library/LaunchAgents/com.happier.cli.daemon.default.plist'),
    newDefinition: (home: string) => join(home, 'Library/LaunchAgents/com.piggercode.cli.daemon.default.plist'),
    renderOld: renderHappierNamedLaunchAgent,
    stopsOld: (command: string, args: readonly string[]) =>
      command === 'launchctl' && args.join(' ') === 'bootout gui/501/com.happier.cli.daemon.default',
    startsNew: (command: string, args: readonly string[]) =>
      command === 'launchctl' && args[0] === 'bootstrap' && String(args.at(-1)).endsWith('com.piggercode.cli.daemon.default.plist'),
    mentionsOld: (_command: string, args: readonly string[]) => args.some((arg) => arg.includes('com.happier.cli.daemon')),
  },
} as const;

type Platform = keyof typeof PLATFORMS;

/**
 * Runs `piggercode service install --json` against a real home. The service manager and the
 * daemons it starts are the OS boundary: stopping the old service stops its daemon, and starting
 * the new one records a current daemon. Discovery, conflict planning, ownership checks and the
 * definitions on disk stay real.
 */
async function runInstall(params: Readonly<{ platform: Platform; oldDaemonRunning: boolean }>): Promise<Readonly<{
  ok: boolean;
  /** The service label of the daemon running before install, as the CLI sees it; `null` when none runs. */
  ownerLabelBefore: string | null;
  commands: ReadonlyArray<Readonly<{ command: string; args: readonly string[] }>>;
}>> {
  const platform = PLATFORMS[params.platform];
  const commands: Array<Readonly<{ command: string; args: readonly string[] }>> = [];
  let statePath = '';
  let currentVersion = '';
  let newServiceStarted = false;
  const writeDaemonState = (state: Partial<DaemonLocallyPersistedState>) => {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      pid: process.pid,
      httpPort: 43125,
      startedAt: Date.now(),
      startedWithPublicReleaseChannel: 'stable',
      startupSource: 'background-service',
      ...state,
    }));
  };
  vi.resetModules();
  mockCurrentProcessAsDaemonLifecycleOwner();
  vi.doMock('./commandExistsInPath', () => ({ commandExistsInPath: () => true }));
  vi.doMock('node:child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:child_process')>(),
    spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
      if (command === 'systemctl' || command === 'launchctl') {
        commands.push({ command, args: [...args] });
      }
      if (platform.stopsOld(command, args)) {
        rmSync(statePath, { force: true });
      }
      if (platform.startsNew(command, args)) {
        newServiceStarted = true;
        writeDaemonState({ startedWithCliVersion: currentVersion, serviceLabel: 'com.piggercode.cli.daemon.default' });
      }
      return {
        status: command === 'launchctl' && args[0] === 'print' && !newServiceStarted ? 1 : 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      };
    }),
  }));
  const [{ runDaemonServiceCliCommand }, { configuration }, { evaluateCurrentDaemonOwner }] = await Promise.all([
    import('./cli'),
    import('@/configuration'),
    import('@/daemon/ownership/evaluateCurrentDaemonOwner'),
  ]);
  currentVersion = configuration.currentCliVersion;
  statePath = configuration.daemonStateFile;
  if (params.oldDaemonRunning) {
    writeDaemonState({ startedWithCliVersion: '0.2.17', serviceLabel: 'com.happier.cli.daemon.default' });
  }
  const ownerBefore = await evaluateCurrentDaemonOwner();
  const ownerLabelBefore = ownerBefore.kind === 'none' ? null : ownerBefore.owner.state.serviceLabel ?? null;
  const output = captureStdoutJsonOutput<{ ok: boolean }>();
  try {
    await runDaemonServiceCliCommand({ argv: ['install', '--json'] });
    return { ok: output.json().ok, ownerLabelBefore, commands };
  } finally {
    output.restore();
  }
}

async function withServiceHome(platform: Platform, fn: (homeDir: string) => Promise<void>): Promise<void> {
  await withConfiguredDaemonTestHome({
    prefix: 'piggercode-previous-name-service-',
    env: { ...SERVICE_ENV, PIGGERCODE_DAEMON_SERVICE_PLATFORM: platform },
  }, async ({ homeDir }) => {
    await writeDaemonSettingsFixture(homeDir, { activeServerId: RELAY.id, servers: { [RELAY.id]: RELAY } });
    await fn(homeDir);
  });
}

describe('service install with a daemon service under its Happier name', () => {
  it.each(['linux', 'darwin'] as const)('replaces the old service running in this home on %s', async (platformName) => {
    const platform = PLATFORMS[platformName];
    await withServiceHome(platformName, async (homeDir) => {
      // The documented migration links the old home to the new one, so the old definition still names the link.
      const linkedOldHome = join(homeDir, '.happier');
      symlinkSync(homeDir, linkedOldHome);
      const oldDefinition = platform.oldDefinition(homeDir);
      mkdirSync(dirname(oldDefinition), { recursive: true });
      writeFileSync(oldDefinition, platform.renderOld(homeDir, linkedOldHome));

      const result = await runInstall({ platform: platformName, oldDaemonRunning: true });

      expect(result.ownerLabelBefore).toBe('com.happier.cli.daemon.default');
      expect(result.ok).toBe(true);
      expect(existsSync(oldDefinition)).toBe(false);
      expect(readFileSync(platform.newDefinition(homeDir), 'utf8')).toContain('com.piggercode.cli.daemon.default');
      const stopOld = result.commands.findIndex(({ command, args }) => platform.stopsOld(command, args));
      const startNew = result.commands.findIndex(({ command, args }) => platform.startsNew(command, args));
      expect(stopOld).toBeGreaterThanOrEqual(0);
      expect(startNew).toBeGreaterThan(stopOld);
    });
  });

  it('leaves a Happier-named service of another home alone', async () => {
    const platform = PLATFORMS.linux;
    await withServiceHome('linux', async (homeDir) => {
      const otherHome = join(homeDir, 'upstream-happier-home');
      mkdirSync(otherHome, { recursive: true });
      const oldDefinition = platform.oldDefinition(homeDir);
      mkdirSync(dirname(oldDefinition), { recursive: true });
      writeFileSync(oldDefinition, platform.renderOld(homeDir, otherHome));

      const result = await runInstall({ platform: 'linux', oldDaemonRunning: false });

      expect(result.ownerLabelBefore).toBe(null);
      expect(result.ok).toBe(true);
      expect(existsSync(oldDefinition)).toBe(true);
      expect(result.commands.some(({ command, args }) => platform.mentionsOld(command, args))).toBe(false);
      expect(existsSync(platform.newDefinition(homeDir))).toBe(true);
    });
  });
});
