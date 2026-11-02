import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleJsonOutput, captureConsoleText, captureStdout, captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
import { handleDaemonCliCommand } from './daemon';

describe('piggercode daemon service', () => {
  it('documents that installed background services should be controlled with piggercode service', async () => {
    const output = captureConsoleText();
    try {
      await handleDaemonCliCommand({
        args: ['daemon'],
        rawArgv: [],
        terminalRuntime: null,
      });

      expect(output.text()).toContain('piggercode daemon stop               Stop a manual daemon');
      expect(output.text()).toContain('use piggercode service stop for installed background services');
      expect(output.text()).toContain('For installed background services, use piggercode service start|stop|restart');
    } finally {
      output.restore();
    }
  });

  it('supports -h as help flag', async () => {
    const stdout = captureStdout();
    try {
      await handleDaemonCliCommand({
        args: ['daemon', 'service', '-h'],
        rawArgv: [],
        terminalRuntime: null,
      });

      expect(stdout.text()).toContain('piggercode service');
      expect(stdout.text()).toContain('Usage:');
      expect(stdout.text()).toContain('piggercode service status [--json]');
      expect(stdout.text()).toContain('piggercode service list [--json]');
    } finally {
      stdout.restore();
    }
  });

  it('prints resolved service paths as JSON', async () => {
    const envScope = createEnvKeyScope([
      'PIGGERCODE_DAEMON_SERVICE_PLATFORM',
      'PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR',
      'PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR',
      'PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID',
    ]);

    await withTempDir('happier-daemon-service-', async (tmp) => {
      envScope.patch({
        PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
        PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: tmp,
        PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: join(tmp, '.piggercode'),
        PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID: 'cloud',
      });

      const output = captureStdoutJsonOutput<{ ok: boolean; paths?: { unitPath?: string } }>();
      try {
        await handleDaemonCliCommand({
          args: ['daemon', 'service', 'paths', '--json'],
          rawArgv: [],
          terminalRuntime: null,
        });

        const parsed = output.json();
        expect(parsed.ok).toBe(true);
        expect(parsed.paths?.unitPath).toBe(join(tmp, '.config', 'systemd', 'user', 'piggercode-daemon.default.service'));
      } finally {
        output.restore();
        envScope.restore();
      }
    });
  });

  it('prints an install plan in --dry-run --json without writing files', async () => {
    const envScope = createEnvKeyScope([
      'PIGGERCODE_DAEMON_SERVICE_PLATFORM',
      'PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR',
      'PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR',
      'PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID',
    ]);

    await withTempDir('happier-daemon-service-', async (tmp) => {
      envScope.patch({
        PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
        PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: tmp,
        PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: join(tmp, '.piggercode'),
      });

      const unitPath = join(tmp, '.config', 'systemd', 'user', 'piggercode-daemon.default.service');

      const output = captureStdoutJsonOutput<{
        ok: boolean;
        plan?: { files?: Array<{ path: string }>; commands?: Array<{ cmd: string; args: string[] }> };
      }>();
      try {
        await handleDaemonCliCommand({
          args: ['daemon', 'service', 'install', '--dry-run', '--json'],
          rawArgv: [],
          terminalRuntime: null,
        });

        const parsed = output.json();
        expect(parsed.ok).toBe(true);
        expect(parsed.plan?.files?.[0]?.path).toBe(unitPath);
        expect(parsed.plan?.commands?.some((c) => c.cmd === 'systemctl')).toBe(true);

        // Dry-run: do not write to disk
        const { existsSync } = await import('node:fs');
        expect(existsSync(unitPath)).toBe(false);
      } finally {
        output.restore();
        envScope.restore();
      }
    });
  });

  it('routes daemon service repair through the bounded repair flow', async () => {
    const envScope = createEnvKeyScope([
      'PIGGERCODE_DAEMON_SERVICE_PLATFORM',
      'PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR',
      'PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR',
      'PIGGERCODE_DAEMON_SERVICE_CHANNEL',
    ]);

    await withTempDir('happier-daemon-service-repair-', async (tmp) => {
      envScope.patch({
        PIGGERCODE_DAEMON_SERVICE_PLATFORM: 'linux',
        PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR: tmp,
        PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR: join(tmp, '.piggercode'),
        PIGGERCODE_DAEMON_SERVICE_CHANNEL: 'stable',
      });

      const output = captureConsoleJsonOutput<{
        ok: boolean;
        executed: boolean;
        actions: Array<{ kind: string }>;
      }>();
      try {
        await handleDaemonCliCommand({
          args: ['daemon', 'service', 'repair', '--json'],
          rawArgv: [],
          terminalRuntime: null,
        });

        const parsed = output.json();
        expect(parsed.ok).toBe(true);
        expect(parsed.executed).toBe(false);
        expect(parsed.actions).toEqual([]);
      } finally {
        output.restore();
        envScope.restore();
      }
    });
  });
});
