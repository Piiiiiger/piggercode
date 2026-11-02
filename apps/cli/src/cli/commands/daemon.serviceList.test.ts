import { join, dirname } from 'node:path';
import * as fs from 'node:fs';
import type { SpawnSyncReturns } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLaunchdPlistXml, renderSystemdServiceUnit, renderWindowsScheduledTaskWrapperPs1 } from '@piggercode/cli-common/service';

const osHomeOverrides = vi.hoisted(() => ({
  homeDir: null as string | null,
  realHomeDir: null as string | null,
}));

// Home discovery is an OS boundary; keep the real CLI graph loaded for every assertion.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => osHomeOverrides.homeDir ?? actual.homedir()),
    userInfo: vi.fn(() => {
      const info = actual.userInfo();
      return osHomeOverrides.realHomeDir === null ? info : { ...info, homedir: osHomeOverrides.realHomeDir };
    }),
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

import { resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths } from '@/daemon/service/cli';
import { resolveDaemonServiceLaunchdLabel } from '@/daemon/service/plan';
import {
  withConfiguredDaemonTestHome,
  writeDaemonSettingsFixture,
} from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { captureStdout } from '@/testkit/logger/captureOutput';
import { captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
vi.mock('@/daemon/doctor', async (importOriginal) => {
  const [{ withCurrentProcessAsDaemonLifecycleOwner }, actual] = await Promise.all([
    import('@/testkit/process/daemonLifecycleOwner'),
    importOriginal<typeof import('@/daemon/doctor')>(),
  ]);
  return withCurrentProcessAsDaemonLifecycleOwner(actual);
});

import { handleServiceCliCommand } from './service';
import { handleDaemonCliCommand } from './daemon';

function writeValidLinuxDaemonServiceDefinition(params: Readonly<{
  path: string;
  releaseChannel?: string;
  targetMode?: 'default-following' | 'pinned';
  happierHomeDir?: string;
}>): void {
  fs.writeFileSync(
    params.path,
    renderSystemdServiceUnit({
      description: 'PiggerCode Daemon',
      execStart: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
      env: {
        PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
        PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: params.targetMode ?? 'pinned',
        PIGGERCODE_PUBLIC_RELEASE_CHANNEL: params.releaseChannel ?? 'stable',
        PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: params.happierHomeDir ?? '/Users/tester/.piggercode',
      },
      wantedBy: 'default.target',
    }),
    'utf-8',
  );
}

function writeValidWindowsDaemonServiceDefinition(params: Readonly<{
  path: string;
  workingDirectory: string;
  releaseChannel?: string;
  targetMode?: 'default-following' | 'pinned';
}>): void {
  fs.writeFileSync(
    params.path,
    renderWindowsScheduledTaskWrapperPs1({
      workingDirectory: params.workingDirectory,
      programArgs: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
      env: {
        PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
        PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: params.targetMode ?? 'pinned',
        PIGGERCODE_PUBLIC_RELEASE_CHANNEL: params.releaseChannel ?? 'stable',
      },
    }),
    'utf-8',
  );
}

describe('piggercode daemon service list', () => {
  beforeEach(async () => {
    osHomeOverrides.homeDir = null;
    osHomeOverrides.realHomeDir = null;
    const childProcess = await import('node:child_process');
    // Successful empty OS enumeration; individual tests override real task results.
    vi.mocked(childProcess.spawnSync).mockImplementation(((cmd: string, args?: readonly string[]) => ({
      pid: 0,
      output: [],
      stdout: cmd === 'powershell.exe' && args?.some((arg) => arg.includes('.GetFolder("\\PiggerCode")')) ? '[]' : Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
    })) as unknown as typeof childProcess.spawnSync);
  });

  it('lists installed background services through the canonical service command', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir, {
          servers: {
            'company.prod': {
              id: 'company.prod',
              name: 'Company Prod',
              serverUrl: 'https://company-prod.example.test',
              webappUrl: 'https://company-prod.example.test',
              createdAt: 0,
              updatedAt: 0,
              lastUsedAt: 0,
            },
          },
        });

        const unitDir = join(homeDir, '.config', 'systemd', 'user');
        fs.mkdirSync(unitDir, { recursive: true });
        writeValidLinuxDaemonServiceDefinition({
          path: join(unitDir, 'piggercode-daemon.company.prod.service'),
          happierHomeDir: join(homeDir, '.piggercode'),
        });

        const output = captureStdoutJsonOutput<{
          entries?: Array<{
            serverId?: string;
            installed?: boolean;
            path?: string;
            platform?: string;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().entries).toEqual(expect.arrayContaining([
            expect.objectContaining({
              serverId: 'company.prod',
              installed: true,
              path: join(homeDir, '.config', 'systemd', 'user', 'piggercode-daemon.company.prod.service'),
            }),
          ]));
        } finally {
          output.restore();
        }
      },
    );
  });

  it('reports which services the desktop app manages and that this CLI lets pinned services of several relays coexist', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-managed-by-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        const unitDir = join(homeDir, '.config', 'systemd', 'user');
        fs.mkdirSync(unitDir, { recursive: true });
        writeValidLinuxDaemonServiceDefinition({ path: join(unitDir, 'piggercode-daemon.personal.service'), happierHomeDir: homeDir });
        const desktopUnit = join(unitDir, 'piggercode-daemon.company.service');
        writeValidLinuxDaemonServiceDefinition({ path: desktopUnit, happierHomeDir: homeDir });
        fs.writeFileSync(
          desktopUnit,
          fs.readFileSync(desktopUnit, 'utf-8').replace('[Service]\n', '[Service]\nEnvironment=PIGGERCODE_DAEMON_SERVICE_MANAGED_BY=desktop\n'),
          'utf-8',
        );

        const output = captureStdoutJsonOutput<{
          capabilities?: { pinnedServiceCoexistence?: boolean };
          entries?: Array<{ serverId?: string; managedBy?: string | null }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().capabilities).toEqual({ pinnedServiceCoexistence: true });
          const byId = new Map((output.json().entries ?? []).map((entry) => [entry.serverId, entry]));
          expect(byId.get('company')?.managedBy).toBe('desktop');
          expect(byId.get('personal')?.managedBy).toBeNull();
        } finally {
          output.restore();
        }
      },
    );
  });

  it('reports a default background service with explicit target mode and pinned release channel', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-default-following-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const unitDir = join(homeDir, '.config', 'systemd', 'user');
        fs.mkdirSync(unitDir, { recursive: true });
        writeValidLinuxDaemonServiceDefinition({
          path: join(unitDir, 'piggercode-daemon.default.service'),
          targetMode: 'default-following',
          releaseChannel: 'preview',
          happierHomeDir: join(homeDir, '.piggercode'),
        });

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            serviceType?: string;
            ring?: string;
            label?: string;
            targetMode?: string | null;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              serviceType: 'daemon',
              ring: 'preview',
              targetMode: 'default-following',
              label: 'piggercode-daemon.default',
            }),
          ]));
        } finally {
          output.restore();
        }
      },
    );
  });

  it('marks the currently owning background service as running in JSON inventory', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-running-owner-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
          },
        });
        const paths = resolveDaemonServicePaths(runtime);
        fs.mkdirSync(dirname(paths.unitPath), { recursive: true });
        fs.writeFileSync(
          paths.unitPath,
          renderSystemdServiceUnit({
            description: 'PiggerCode Daemon',
            execStart: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
            env: {
              PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
              PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
              PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
              PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: join(homeDir, '.piggercode'),
            },
            wantedBy: 'default.target',
          }),
          'utf-8',
        );

        const { writeDaemonState } = await import('@/persistence');
        writeDaemonState({
          pid: process.pid,
          httpPort: 43118,
          startedAt: Date.now(),
          startedWithCliVersion: '0.0.0-test',
          startedWithPublicReleaseChannel: 'stable',
          startupSource: 'background-service',
          serviceLabel: resolveDaemonServiceLaunchdLabel(runtime.instanceId, runtime.channel, runtime.targetMode),
        });

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            label?: string;
            running?: boolean;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              label: paths.unitName.replace(/\.service$/i, ''),
              running: true,
            }),
          ]));
        } finally {
          output.restore();
        }
      },
    );
  });

  it('includes configured and running CLI versions in JSON inventory when they can be resolved', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-cli-versions-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
          },
        });
        const paths = resolveDaemonServicePaths(runtime);
        fs.mkdirSync(dirname(paths.unitPath), { recursive: true });
        fs.writeFileSync(
          paths.unitPath,
          renderSystemdServiceUnit({
            description: 'PiggerCode Daemon',
            execStart: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
            env: {
              PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
              PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
              PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
              PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: join(homeDir, '.piggercode'),
            },
            wantedBy: 'default.target',
          }),
          'utf-8',
        );

        const managedCliPath = join(homeDir, '.piggercode', 'cli', 'current', 'piggercode');
        fs.mkdirSync(dirname(managedCliPath), { recursive: true });
        fs.writeFileSync(
          managedCliPath,
          '#!/usr/bin/env bash\nset -euo pipefail\nif [[ "${1:-}" == "--version" ]]; then\n  echo "0.0.0-configured"\n  exit 0\nfi\nexit 0\n',
          'utf-8',
        );
        fs.chmodSync(managedCliPath, 0o755);

        const { writeDaemonState } = await import('@/persistence');
        writeDaemonState({
          pid: process.pid,
          httpPort: 43118,
          startedAt: Date.now(),
          startedWithCliVersion: '0.0.0-running',
          startedWithPublicReleaseChannel: 'stable',
          startupSource: 'background-service',
          serviceLabel: resolveDaemonServiceLaunchdLabel(runtime.instanceId, runtime.channel, runtime.targetMode),
        });

        const childProcess = await import('node:child_process');
        const spawnSyncMock = vi.mocked(childProcess.spawnSync);
        spawnSyncMock.mockImplementation(((cmd: string, args?: readonly string[]) => {
          const argv = Array.isArray(args) ? args.map((a) => String(a ?? '')) : [];
          if (cmd === managedCliPath && argv[0] === '--version') {
            return {
              pid: 0,
              output: [],
              stdout: '0.0.0-configured\n',
              stderr: '',
              status: 0,
              signal: null,
              error: undefined,
            } as unknown as SpawnSyncReturns<string>;
          }
          return {
            pid: 0,
            output: [],
            stdout: '',
            stderr: '',
            status: 3,
            signal: null,
            error: undefined,
          } as unknown as SpawnSyncReturns<string>;
        }) as unknown as typeof childProcess.spawnSync);

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            label?: string;
            running?: boolean;
            configuredCliVersion?: string | null;
            runningCliVersion?: string | null;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              label: paths.unitName.replace(/\.service$/i, ''),
              running: true,
              configuredCliVersion: '0.0.0-configured',
              runningCliVersion: '0.0.0-running',
            }),
          ]));
        } finally {
          spawnSyncMock.mockReset();
          output.restore();
        }
      },
    );
  });

  it('marks an active systemd user unit as running in JSON inventory even when daemon state is missing', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-running-systemd-active-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
          },
        });
        const paths = resolveDaemonServicePaths(runtime);
        fs.mkdirSync(dirname(paths.unitPath), { recursive: true });
        fs.writeFileSync(
          paths.unitPath,
          renderSystemdServiceUnit({
            description: 'PiggerCode Daemon',
            execStart: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
            env: {
              PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
              PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
              PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
            },
            wantedBy: 'default.target',
          }),
          'utf-8',
        );

        const childProcess = await import('node:child_process');
        const spawnSyncMock = vi.mocked(childProcess.spawnSync);
        spawnSyncMock.mockImplementation(((cmd: string, args?: readonly string[]) => {
          const argv = Array.isArray(args) ? args.map((a) => String(a ?? '')) : [];
          if (cmd === 'systemctl' && argv[0] === '--user' && argv[1] === 'is-active' && argv[2] === paths.unitName) {
            return {
              pid: 0,
              output: [],
              stdout: 'active\n',
              stderr: '',
              status: 0,
              signal: null,
              error: undefined,
            } as unknown as SpawnSyncReturns<string>;
          }
          return {
            pid: 0,
            output: [],
            stdout: '',
            stderr: '',
            status: 3,
            signal: null,
            error: undefined,
          } as unknown as SpawnSyncReturns<string>;
        }) as unknown as typeof childProcess.spawnSync);

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            label?: string;
            running?: boolean;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              label: paths.unitName.replace(/\.service$/i, ''),
              running: true,
            }),
          ]));
        } finally {
          spawnSyncMock.mockReset();
          output.restore();
        }
      },
    );
  });

  it('marks an active launch agent as running in JSON inventory even when daemon state is missing', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-running-launchctl-active-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'darwin',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'darwin',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
          },
        });
        const paths = resolveDaemonServicePaths(runtime);
        fs.mkdirSync(dirname(paths.installedPath), { recursive: true });
        fs.writeFileSync(
          paths.installedPath,
          buildLaunchdPlistXml({
            label: paths.label,
            programArgs: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
            env: {
              PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
              PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
              PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
            },
            stdoutPath: join(homeDir, '.piggercode', 'logs', 'daemon-service.out.log'),
            stderrPath: join(homeDir, '.piggercode', 'logs', 'daemon-service.err.log'),
            workingDirectory: homeDir,
          }),
          'utf-8',
        );

        const childProcess = await import('node:child_process');
        const spawnSyncMock = vi.mocked(childProcess.spawnSync);
        spawnSyncMock.mockImplementation(((cmd: string, args?: readonly string[]) => {
          const argv = Array.isArray(args) ? args.map((a) => String(a ?? '')) : [];
          if (cmd === 'launchctl' && argv[0] === 'print' && argv[1] === `gui/${runtime.uid ?? 0}/${paths.label}`) {
            return {
              pid: 0,
              output: [],
              stdout: 'state = running\n',
              stderr: '',
              status: 0,
              signal: null,
              error: undefined,
            } as unknown as SpawnSyncReturns<string>;
          }
          return {
            pid: 0,
            output: [],
            stdout: '',
            stderr: '',
            status: 1,
            signal: null,
            error: undefined,
          } as unknown as SpawnSyncReturns<string>;
        }) as unknown as typeof childProcess.spawnSync);

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            label?: string;
            running?: boolean;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              label: paths.label,
              running: true,
            }),
          ]));
        } finally {
          spawnSyncMock.mockReset();
          output.restore();
        }
      },
    );
  });

  it('does not mark a loaded but not running launch agent as running in JSON inventory', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-launchctl-not-running-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'darwin',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'darwin',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
          },
        });
        const paths = resolveDaemonServicePaths(runtime);
        fs.mkdirSync(dirname(paths.installedPath), { recursive: true });
        fs.writeFileSync(
          paths.installedPath,
          buildLaunchdPlistXml({
            label: paths.label,
            programArgs: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
            env: {
              PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
              PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
              PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
            },
            stdoutPath: join(homeDir, '.piggercode', 'logs', 'daemon-service.out.log'),
            stderrPath: join(homeDir, '.piggercode', 'logs', 'daemon-service.err.log'),
            workingDirectory: homeDir,
          }),
          'utf-8',
        );

        const childProcess = await import('node:child_process');
        const spawnSyncMock = vi.mocked(childProcess.spawnSync);
        spawnSyncMock.mockImplementation(((cmd: string, args?: readonly string[]) => {
          const argv = Array.isArray(args) ? args.map((a) => String(a ?? '')) : [];
          if (cmd === 'launchctl' && argv[0] === 'print' && argv[1] === `gui/${runtime.uid ?? 0}/${paths.label}`) {
            return {
              pid: 0,
              output: [],
              stdout: 'state = not running\n',
              stderr: '',
              status: 0,
              signal: null,
              error: undefined,
            } as unknown as SpawnSyncReturns<string>;
          }
          return {
            pid: 0,
            output: [],
            stdout: '',
            stderr: '',
            status: 1,
            signal: null,
            error: undefined,
          } as unknown as SpawnSyncReturns<string>;
        }) as unknown as typeof childProcess.spawnSync);

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            label?: string;
            running?: boolean;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              label: paths.label,
              running: false,
            }),
          ]));
        } finally {
          spawnSyncMock.mockReset();
          output.restore();
        }
      },
    );
  });

  it('marks an active Windows scheduled task as running in JSON inventory even when daemon state is missing', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-service-list-running-schtasks-active-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'win32',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'win32',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
          },
        });
        const paths = resolveDaemonServicePaths(runtime);
        fs.mkdirSync(dirname(paths.installedPath), { recursive: true });
        writeValidWindowsDaemonServiceDefinition({
          path: paths.installedPath,
          workingDirectory: join(homeDir, '.piggercode'),
          targetMode: 'default-following',
          releaseChannel: 'stable',
        });

        const childProcess = await import('node:child_process');
        const spawnSyncMock = vi.mocked(childProcess.spawnSync);
        spawnSyncMock.mockImplementation(((cmd: string, args?: readonly string[]) => {
          const argv = Array.isArray(args) ? args.map((a) => String(a ?? '')) : [];
          if (cmd === 'powershell.exe' && argv.some((arg) => arg.includes('.GetFolder("\\PiggerCode")'))) {
            return { pid: 0, output: [], stdout: '[]', stderr: '', status: 0, signal: null } satisfies SpawnSyncReturns<string>;
          }
          if (
            cmd === 'schtasks'
            && argv[0] === '/Query'
            && argv[1] === '/TN'
            && argv[2] === paths.taskName
            && argv[3] === '/FO'
            && argv[4] === 'LIST'
            && argv[5] === '/V'
          ) {
            return {
              pid: 0,
              output: [],
              stdout: 'Status: Running\nScheduled Task State: Enabled\n',
              stderr: '',
              status: 0,
              signal: null,
              error: undefined,
            } as unknown as SpawnSyncReturns<string>;
          }
          return {
            pid: 0,
            output: [],
            stdout: '',
            stderr: '',
            status: 1,
            signal: null,
            error: undefined,
          } as unknown as SpawnSyncReturns<string>;
        }) as unknown as typeof childProcess.spawnSync);

        const output = captureStdoutJsonOutput<{
          services?: Array<{
            label?: string;
            running?: boolean;
          }>;
        }>();
        try {
          await handleServiceCliCommand({ args: ['service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              label: paths.taskName,
              running: true,
            }),
          ]));
        } finally {
          spawnSyncMock.mockReset();
          output.restore();
        }
      },
    );
  });

  it('lists per-server installed unit paths on linux', async () => {
    const output = captureStdout();

    try {
      await withConfiguredDaemonTestHome(
        {
          prefix: 'happier-daemon-service-list-',
          env: {
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
            PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
          },
        },
        async ({ homeDir }) => {
          process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
          process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
          await writeDaemonSettingsFixture(homeDir, {
            servers: {
              'company.prod': {
                id: 'company.prod',
                name: 'Company Prod',
                serverUrl: 'https://company-prod.example.test',
                webappUrl: 'https://company-prod.example.test',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
              },
            },
          });

          const unitDir = join(homeDir, '.config', 'systemd', 'user');
          fs.mkdirSync(unitDir, { recursive: true });
          writeValidLinuxDaemonServiceDefinition({
            path: join(unitDir, 'piggercode-daemon.company.prod.service'),
            happierHomeDir: join(homeDir, '.piggercode'),
          });

          await handleDaemonCliCommand({ args: ['daemon', 'service', 'list'], rawArgv: [], terminalRuntime: null });

          const out = output.text();
          expect(out).toContain('company.prod');
          expect(out).toContain('piggercode-daemon.company.prod.service');
          expect(out.toLowerCase()).toContain('installed');
        },
      );
    } finally {
      output.restore();
    }
  });

  it('prints per-server service entries as JSON on Windows with installed-path parity', async () => {
    await withConfiguredDaemonTestHome(
      {
        prefix: 'happier-daemon-service-list-json-',
        env: {
          PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'win32',
          PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
          PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
        },
      },
      async ({ homeDir }) => {
        process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
        process.env.PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR = join(homeDir, '.piggercode');
        process.env.PIGGERCODE_DAEMON_SERVICE_CHANNEL = 'stable';
        await writeDaemonSettingsFixture(homeDir);

        const runtime = resolveDaemonServiceCliRuntimeFromEnv({
          processEnv: {
            ...process.env,
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'win32',
            PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'pinned',
            PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID: 'company',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
            PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: join(homeDir, '.piggercode'),
            PIGGERCODE_DAEMON_SERVICE_SERVER_URL: 'https://company.example.test',
            PIGGERCODE_DAEMON_SERVICE_WEBAPP_URL: 'https://company.example.test',
          },
        });
        const wrapperPath = resolveDaemonServicePaths(runtime).wrapperPath;
        fs.mkdirSync(dirname(wrapperPath), { recursive: true });
        writeValidWindowsDaemonServiceDefinition({
          path: wrapperPath,
          workingDirectory: homeDir,
          releaseChannel: 'stable',
          targetMode: 'pinned',
        });
        expect(fs.existsSync(wrapperPath)).toBe(true);

        const output = captureStdoutJsonOutput<{
          entries?: Array<{
            serverId?: string;
            installed?: boolean;
            path?: string;
            platform?: string;
            releaseChannel?: string;
          }>;
          services?: Array<{
            serviceType?: string;
            ring?: string;
            label?: string;
            targetMode?: string | null;
          }>;
        }>();

        try {
          await handleDaemonCliCommand({ args: ['daemon', 'service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().entries).toEqual(expect.arrayContaining([
            expect.objectContaining({
              serverId: 'company',
              installed: true,
              platform: 'win32',
              path: wrapperPath,
              releaseChannel: 'stable',
            }),
          ]));
          expect(output.json().services).toEqual(expect.arrayContaining([
            expect.objectContaining({
              serviceType: 'daemon',
              ring: 'stable',
              targetMode: 'pinned',
            }),
          ]));
          expect(output.json().services?.[0]?.label).toContain('piggercode-daemon.company');
        } finally {
          output.restore();
        }
      },
    );
  });

  it('expands ~/ daemon service home overrides before listing installed entries', async () => {
    const output = captureStdoutJsonOutput<{
      entries?: Array<{
        serverId?: string;
        installed?: boolean;
        path?: string;
        platform?: string;
      }>;
    }>();

    try {
      await withConfiguredDaemonTestHome(
        {
          prefix: 'happier-daemon-service-list-tilde-',
          env: {
            HOME: '/tmp/placeholder',
            USERPROFILE: '/tmp/placeholder',
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
            PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '~/service-home',
            PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: '~/service-happier',
          },
        },
        async ({ homeDir }) => {
          const scopedHome = join(homeDir, 'scoped-home');
          process.env.HOME = scopedHome;
          process.env.USERPROFILE = scopedHome;
          await writeDaemonSettingsFixture(homeDir);

          const unitPath = join(scopedHome, 'service-home', '.config', 'systemd', 'user', 'piggercode-daemon.company.service');
          fs.mkdirSync(dirname(unitPath), { recursive: true });
          writeValidLinuxDaemonServiceDefinition({
            path: unitPath,
            happierHomeDir: join(scopedHome, 'service-happier'),
          });

          await handleDaemonCliCommand({ args: ['daemon', 'service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().entries).toEqual(expect.arrayContaining([
            expect.objectContaining({
              serverId: 'company',
              installed: true,
              platform: 'linux',
              path: unitPath,
            }),
          ]));
        },
      );
    } finally {
      output.restore();
    }
  });

  it('uses the real OS user home for service listing when HOME is stack-isolated and no explicit override is set', async () => {
    osHomeOverrides.homeDir = '/isolated-stack-home';

    const output = captureStdoutJsonOutput<{
      entries?: Array<{
        serverId?: string;
        installed?: boolean;
        path?: string;
        platform?: string;
      }>;
    }>();

    try {
      await withConfiguredDaemonTestHome(
        {
          prefix: 'happier-daemon-service-list-real-home-',
          env: {
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
            PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: '',
            PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: '',
            HOME: '/isolated-stack-home',
            USERPROFILE: '/isolated-stack-home',
          },
        },
        async ({ homeDir }) => {
          const mockedRealHomeDir = join(homeDir, 'real-user-home');
          osHomeOverrides.realHomeDir = mockedRealHomeDir;
          await writeDaemonSettingsFixture(homeDir);

          const unitPath = join(mockedRealHomeDir, '.config', 'systemd', 'user', 'piggercode-daemon.company.service');
          fs.mkdirSync(dirname(unitPath), { recursive: true });
          writeValidLinuxDaemonServiceDefinition({
            path: unitPath,
            happierHomeDir: join(mockedRealHomeDir, '.piggercode'),
          });

          await handleDaemonCliCommand({ args: ['daemon', 'service', 'list', '--json'], rawArgv: [], terminalRuntime: null });

          expect(output.json().entries).toEqual(expect.arrayContaining([
            expect.objectContaining({
              serverId: 'company',
              installed: true,
              platform: 'linux',
              path: unitPath,
            }),
          ]));
        },
      );
    } finally {
      output.restore();
      osHomeOverrides.homeDir = null;
      osHomeOverrides.realHomeDir = null;
    }
  });
});
