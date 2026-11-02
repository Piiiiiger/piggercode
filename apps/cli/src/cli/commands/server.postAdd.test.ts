import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { renderSystemdServiceUnit } from '@piggercode/cli-common/service';
import { describe, expect, it } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';

import { handleServerCommand } from './server';

const envKeys = [
  'PIGGERCODE_HOME_DIR',
  'PIGGERCODE_SERVER_URL',
  'PIGGERCODE_WEBAPP_URL',
  'PIGGERCODE_DAEMON_SERVICE_PLATFORM',
  'PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR',
  'PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR',
  'PIGGERCODE_ACTIVE_SERVER_ID',
] as const;

let envScope = createEnvKeyScope(envKeys);

function writeInstalledDefaultFollowingServiceFixture(homeDir: string, happierHomeDir: string): void {
  const installedPath = join(homeDir, '.config', 'systemd', 'user', 'piggercode-daemon.default.service');
  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(
    installedPath,
    renderSystemdServiceUnit({
      description: 'PiggerCode CLI daemon (default)',
      execStart: ['/Users/tester/.piggercode/cli/current/happier', 'daemon', 'start-sync'],
      env: {
        PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
        PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        PIGGERCODE_PUBLIC_RELEASE_CHANNEL: 'stable',
        PIGGERCODE_HOME_DIR: happierHomeDir,
      },
      wantedBy: 'default.target',
    }),
    'utf-8',
  );
}

describe('piggercode server add', () => {
  it('prints follow-up daemon commands in non-interactive mode when --use is set', async () => {
    const home = await createTempDir('happier-server-add-');
    const output = captureConsoleLogAndMuteStdout();

    try {
      process.env.PIGGERCODE_HOME_DIR = home;
      delete process.env.PIGGERCODE_ACTIVE_SERVER_ID;
      delete process.env.PIGGERCODE_SERVER_URL;
      delete process.env.PIGGERCODE_WEBAPP_URL;
      reloadConfiguration();

      await handleServerCommand([
        'add',
        '--yes',
        '--name',
        'Company',
        '--server-url',
        'https://company.example.test',
        '--webapp-url',
        'https://company.example.test',
        '--use',
      ]);

      const out = output.logs.join('\n');
      expect(out).toContain('piggercode --server');
      expect(out).toContain('daemon start');
      expect(out).toContain('service install');
      expect(out).not.toContain('daemon service install');
    } finally {
      output.restore();
      envScope.restore();
      envScope = createEnvKeyScope(envKeys);
      reloadConfiguration();
      await removeTempDir(home);
    }
  });

  it('prints follow-up daemon commands in non-interactive mode even when --use is not set', async () => {
    const home = await createTempDir('happier-server-add-no-use-');
    const output = captureConsoleLogAndMuteStdout();

    try {
      process.env.PIGGERCODE_HOME_DIR = home;
      delete process.env.PIGGERCODE_ACTIVE_SERVER_ID;
      delete process.env.PIGGERCODE_SERVER_URL;
      delete process.env.PIGGERCODE_WEBAPP_URL;
      reloadConfiguration();

      await handleServerCommand([
        'add',
        '--yes',
        '--name',
        'Company',
        '--server-url',
        'https://company.example.test',
        '--webapp-url',
        'https://company.example.test',
      ]);

      const out = output.logs.join('\n');
      expect(out).toContain('Next steps');
      expect(out).toContain('piggercode --server');
      expect(out).toContain('daemon start');
      expect(out).toContain('service install');
      expect(out).not.toContain('daemon service install');
    } finally {
      output.restore();
      envScope.restore();
      envScope = createEnvKeyScope(envKeys);
      reloadConfiguration();
      await removeTempDir(home);
    }
  });

  it('guides to restart a default-following background service after adding and using a new server', async () => {
    const home = await createTempDir('happier-server-add-use-followup-');
    const happierHomeDir = join(home, '.piggercode');
    const output = captureConsoleLogAndMuteStdout();

    try {
      process.env.PIGGERCODE_HOME_DIR = happierHomeDir;
      process.env.PIGGERCODE_DAEMON_SERVICE_PLATFORM = 'linux';
      process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = home;
      process.env.PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR = happierHomeDir;
      delete process.env.PIGGERCODE_ACTIVE_SERVER_ID;
      delete process.env.PIGGERCODE_SERVER_URL;
      delete process.env.PIGGERCODE_WEBAPP_URL;
      writeInstalledDefaultFollowingServiceFixture(home, happierHomeDir);
      reloadConfiguration();

      await handleServerCommand([
        'add',
        '--yes',
        '--name',
        'Company',
        '--server-url',
        'https://company.example.test',
        '--webapp-url',
        'https://company.example.test',
        '--use',
      ]);

      const out = output.logs.join('\n');
      expect(out).toContain('Authenticate PiggerCode against https://company.example.test');
      expect(out).toContain('piggercode auth login');
      expect(out).toContain('piggercode service restart');
      expect(out).not.toContain('daemon service restart');
    } finally {
      output.restore();
      envScope.restore();
      envScope = createEnvKeyScope(envKeys);
      reloadConfiguration();
      await removeTempDir(home);
    }
  });

  it('guides to restart a default-following background service after switching the active server', async () => {
    const home = await createTempDir('happier-server-use-followup-');
    const happierHomeDir = join(home, '.piggercode');
    const output = captureConsoleLogAndMuteStdout();

    try {
      process.env.PIGGERCODE_HOME_DIR = happierHomeDir;
      process.env.PIGGERCODE_DAEMON_SERVICE_PLATFORM = 'linux';
      process.env.PIGGERCODE_DAEMON_SERVICE_USER_HOME_DIR = home;
      process.env.PIGGERCODE_DAEMON_SERVICE_PIGGERCODE_HOME_DIR = happierHomeDir;
      delete process.env.PIGGERCODE_ACTIVE_SERVER_ID;
      delete process.env.PIGGERCODE_SERVER_URL;
      delete process.env.PIGGERCODE_WEBAPP_URL;
      writeInstalledDefaultFollowingServiceFixture(home, happierHomeDir);
      reloadConfiguration();

      await handleServerCommand([
        'add',
        '--yes',
        '--name',
        'Alpha',
        '--server-url',
        'https://alpha.example.test',
        '--webapp-url',
        'https://alpha.example.test',
      ]);
      await handleServerCommand([
        'add',
        '--yes',
        '--name',
        'Beta',
        '--server-url',
        'https://beta.example.test',
        '--webapp-url',
        'https://beta.example.test',
      ]);
      output.logs.length = 0;

      await handleServerCommand(['use', 'Beta']);

      const out = output.logs.join('\n');
      expect(out).toContain('Authenticate PiggerCode against https://beta.example.test');
      expect(out).toContain('piggercode auth login');
      expect(out).toContain('piggercode service restart');
      expect(out).not.toContain('daemon service restart');
    } finally {
      output.restore();
      envScope.restore();
      envScope = createEnvKeyScope(envKeys);
      reloadConfiguration();
      await removeTempDir(home);
    }
  });
});
