import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { updateSettings } from '@/persistence';

import type { FilesystemAccessPolicy } from '../fileSystem/accessPolicy/filesystemAccessPolicy';
import { registerMachineCommandHandlers } from './registerMachineCommandHandlers';

type Handler = (data: unknown) => Promise<unknown>;

const tempDirectories: string[] = [];
const homeScope = createEnvKeyScope(['HOME', 'USERPROFILE']);

afterEach(() => {
  homeScope.restore();
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createTempDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'piggercode-machine-command-')));
  tempDirectories.push(directory);
  return directory;
}

function registerHandlers(workingDirectory: string, accessPolicy: FilesystemAccessPolicy = { kind: 'osUser' }): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const registrar: RpcHandlerRegistrar = {
    registerHandler(method, handler) {
      handlers.set(method, handler as Handler);
    },
  };
  registerMachineCommandHandlers({ rpcHandlerManager: registrar, workingDirectory, accessPolicy });
  return handlers;
}

function requireHandler(handlers: Map<string, Handler>, method: string): Handler {
  const handler = handlers.get(method);
  if (!handler) throw new Error(`${method} was not registered`);
  return handler;
}

function registerHandler(workingDirectory: string, accessPolicy: FilesystemAccessPolicy = { kind: 'osUser' }): Handler {
  return requireHandler(registerHandlers(workingDirectory, accessPolicy), RPC_METHODS.DAEMON_MACHINE_COMMAND_RUN);
}

async function setRemoteCommands(enabled: boolean): Promise<void> {
  await updateSettings((current) => ({ ...current, remoteCommandsEnabled: enabled }));
}

describe.skipIf(process.platform === 'win32')('machine command RPC on the target machine', () => {
  it('runs nothing until the machine owner turns remote commands on here', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-machine-command-home-' }, async () => {
      const workdir = createTempDirectory();
      const run = registerHandler(workdir);

      const result = await run({ command: 'touch ran', cwd: workdir });

      expect(result).toMatchObject({ success: false, errorCode: 'remote_commands_disabled' });
      expect(existsSync(join(workdir, 'ran'))).toBe(false);

      await setRemoteCommands(true);
      await setRemoteCommands(false);
      expect(await run({ command: 'touch ran', cwd: workdir })).toMatchObject({ errorCode: 'remote_commands_disabled' });
      expect(existsSync(join(workdir, 'ran'))).toBe(false);
    });
  });

  it('runs the command in the requested directory and reports its exit code once on', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-machine-command-home-' }, async () => {
      const workdir = createTempDirectory();
      const run = registerHandler(workdir);
      await setRemoteCommands(true);

      const ok = await run({ command: 'pwd && touch ran', cwd: workdir });
      const failed = await run({ command: 'echo nope >&2; exit 3', cwd: workdir });

      expect(ok).toMatchObject({ success: true, exitCode: 0 });
      expect(String((ok as { stdout?: string }).stdout).trim()).toBe(workdir);
      expect(existsSync(join(workdir, 'ran'))).toBe(true);
      expect(failed).toMatchObject({ success: false, exitCode: 3 });
      expect((failed as { errorCode?: string }).errorCode).toBeUndefined();
      expect(String((failed as { stderr?: string }).stderr)).toContain('nope');
    });
  });

  it('starts in the default directory or under ~ and refuses directories outside the access policy', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-machine-command-home-' }, async () => {
      const allowedRoot = createTempDirectory();
      const outside = createTempDirectory();
      mkdirSync(join(allowedRoot, 'project'));
      homeScope.patch({ HOME: allowedRoot, USERPROFILE: allowedRoot });
      const run = registerHandler(join(allowedRoot, 'unused-default'), { kind: 'restrictedRoots', roots: [allowedRoot] });
      await setRemoteCommands(true);

      const atDefault = await run({ command: 'pwd' });
      const underHome = await run({ command: 'pwd', cwd: '~/project' });
      const refused = await run({ command: 'touch ran', cwd: outside });

      expect(String((atDefault as { stdout?: string }).stdout).trim()).toBe(allowedRoot);
      expect(String((underHome as { stdout?: string }).stdout).trim()).toBe(join(allowedRoot, 'project'));
      expect(refused).toMatchObject({ success: false, errorCode: 'cwd_not_allowed' });
      expect(existsSync(join(outside, 'ran'))).toBe(false);
    });
  });

  it('rejects a malformed request without running anything', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-machine-command-home-' }, async () => {
      const workdir = createTempDirectory();
      const run = registerHandler(workdir);
      await setRemoteCommands(true);

      expect(await run({ cwd: workdir })).toMatchObject({ success: false, errorCode: 'invalid_request' });
      expect(await run({ command: 'true', timeoutMs: -1 })).toMatchObject({ success: false, errorCode: 'invalid_request' });
    });
  });

  it('lets the app read and change the switch on this machine', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-machine-command-home-' }, async () => {
      const workdir = createTempDirectory();
      const handlers = registerHandlers(workdir);
      const getSettings = requireHandler(handlers, RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_GET);
      const setSettings = requireHandler(handlers, RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_SET);
      const run = requireHandler(handlers, RPC_METHODS.DAEMON_MACHINE_COMMAND_RUN);

      expect(await getSettings({})).toEqual({ remoteCommandsEnabled: false });
      expect(await setSettings({ enabled: true })).toEqual({ remoteCommandsEnabled: true });
      expect(await getSettings({})).toEqual({ remoteCommandsEnabled: true });
      expect(await run({ command: 'touch ran', cwd: workdir })).toMatchObject({ success: true, exitCode: 0 });

      expect(await setSettings({ enabled: false })).toEqual({ remoteCommandsEnabled: false });
      expect(await run({ command: 'touch ran-again', cwd: workdir })).toMatchObject({ errorCode: 'remote_commands_disabled' });
      expect(existsSync(join(workdir, 'ran-again'))).toBe(false);

      await expect(setSettings({ enabled: 'yes' })).rejects.toThrow();
      expect(await getSettings({})).toEqual({ remoteCommandsEnabled: false });
    });
  });
});
