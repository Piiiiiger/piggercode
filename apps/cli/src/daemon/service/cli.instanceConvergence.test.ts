import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { withConfiguredDaemonTestHome, writeDaemonSettingsFixture } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { mockCurrentProcessAsDaemonLifecycleOwner } from '@/testkit/process/daemonLifecycleOwner';
import { captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
import type { DaemonLocallyPersistedState } from '@/persistence';

afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('@/daemon/doctor');
    vi.doUnmock('./commandExistsInPath');
    vi.doUnmock('node:os');
    vi.resetModules();
});

it('converges an instance-only pinned install for an environment-selected relay without pinned service environment', async () => {
    await withConfiguredDaemonTestHome({
        prefix: 'happier-service-instance-convergence-',
        env: {
            PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'darwin',
            PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: undefined,
            PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: undefined,
            PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID: undefined,
            PIGGERCODE_ACTIVE_SERVER_ID: 'full-live-qa-b',
            PIGGERCODE_SERVER_URL: 'http://127.0.0.1:43282',
            PIGGERCODE_PUBLIC_SERVER_URL: undefined,
            PIGGERCODE_LOCAL_SERVER_URL: undefined,
            PIGGERCODE_WEBAPP_URL: undefined,
            PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: undefined,
            PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID: undefined,
            PIGGERCODE_DAEMON_SERVICE_SERVER_URL: undefined,
            PIGGERCODE_DAEMON_SERVICE_PUBLIC_SERVER_URL: undefined,
            PIGGERCODE_DAEMON_SERVICE_WEBAPP_URL: undefined,
            PIGGERCODE_DAEMON_SERVICE_NODE_PATH: process.execPath,
            PIGGERCODE_DAEMON_SERVICE_ENTRY_PATH: join(process.cwd(), 'src/index.ts'),
            PIGGERCODE_DAEMON_SERVICE_MANAGED_BY: 'desktop',
            PIGGERCODE_DAEMON_SERVICE_BUNDLE_ID: 'dev.happier.app.fullqa02',
            PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
            PIGGERCODE_DAEMON_SERVICE_CHANNEL: undefined,
            PIGGERCODE_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '250',
            PIGGERCODE_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
            PIGGERCODE_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
        },
    }, async ({ homeDir }) => {
        await writeDaemonSettingsFixture(homeDir, {
            activeServerId: 'cloud',
            servers: {
                cloud: { id: 'cloud', name: 'Cloud', serverUrl: 'https://api.happier.dev', webappUrl: 'https://app.happier.dev' },
                'full-live-qa-b': { id: 'full-live-qa-b', name: 'QA B', serverUrl: 'http://127.0.0.1:43282', webappUrl: 'http://127.0.0.1:43282' },
            },
        });
        vi.resetModules();
        mockCurrentProcessAsDaemonLifecycleOwner();
        // Keep the OS user home disposable without adding service-specific home overrides
        // absent from the reported command environment.
        vi.doMock('node:os', async (importOriginal) => {
            const actual = await importOriginal<typeof import('node:os')>();
            return {
                ...actual,
                homedir: () => homeDir,
                userInfo: () => ({ ...actual.userInfo(), homedir: homeDir }),
            };
        });
        // The host is Linux; emulate launchctl availability alongside its process adapter.
        vi.doMock('./commandExistsInPath', () => ({ commandExistsInPath: () => true }));
        let serviceStarted = false;
        let currentVersion = '';
        // launchctl and its launched process are the OS boundary; planning, installed-definition
        // checks, persistence, relay selection and daemon ownership remain real.
        vi.doMock('node:child_process', async (importOriginal) => ({
            ...await importOriginal<typeof import('node:child_process')>(),
            spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
                if (command === 'launchctl' && args[0] === 'bootstrap') {
                    serviceStarted = true;
                    const statePath = join(homeDir, 'servers/full-live-qa-b/daemon.state.json');
                    mkdirSync(dirname(statePath), { recursive: true });
                    writeFileSync(statePath, JSON.stringify({
                        pid: process.pid,
                        httpPort: 43124,
                        startedAt: Date.now(),
                        startedWithCliVersion: currentVersion,
                        startedWithPublicReleaseChannel: 'stable',
                        startupSource: 'background-service',
                        serviceLabel: 'com.happier.cli.daemon.full-live-qa-b',
                    } satisfies DaemonLocallyPersistedState));
                }
                return {
                    status: command === 'launchctl' && args[0] === 'print' && !serviceStarted ? 1 : 0,
                    stdout: Buffer.from(''),
                    stderr: Buffer.from(''),
                };
            }),
        }));

        const [{ runDaemonServiceCliCommand }, { configuration }, { readDaemonState }] = await Promise.all([
            import('./cli'),
            import('@/configuration'),
            import('@/persistence'),
        ]);
        currentVersion = configuration.currentCliVersion;
        const output = captureStdoutJsonOutput<{ ok: boolean }>();
        try {
            await runDaemonServiceCliCommand({ argv: ['install', '--instance', 'full-live-qa-b', '--autostart', 'on-demand', '--json'] });
            expect(output.json().ok).toBe(true);
            expect((await readDaemonState())?.serviceLabel).toBe('com.happier.cli.daemon.full-live-qa-b');
        } finally {
            output.restore();
        }
    });
});
