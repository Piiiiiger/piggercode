import {
  MachineCommandRunRequestSchema,
  MachineCommandSettingsSetRequestSchema,
  type MachineCommandRunResponse,
  type MachineCommandSettingsResponse,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { readSettings, updateSettings } from '@/persistence';
import { logger } from '@/ui/logger';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

import { executeShellCommandRequest } from '../bash';
import {
  type FilesystemAccessPolicy,
  resolveFilesystemPolicyDefaultDirectory,
} from '../fileSystem/accessPolicy/filesystemAccessPolicy';
import { authorizeFilesystemPath } from '../fileSystem/accessPolicy/filesystemPathAuthorization';

const REMOTE_COMMANDS_DISABLED_MESSAGE =
  'Remote commands are turned off on this machine. Turn them on in the app (machine page) or with `piggercode machine remote-commands on`.';

/** Whether this machine accepts remote commands (device-local; off unless explicitly on). */
export async function readRemoteCommandsEnabled(): Promise<boolean> {
  return (await readSettings()).remoteCommandsEnabled === true;
}

/** The one writer of the switch: `piggercode machine remote-commands` and the app's machine screen. */
export async function writeRemoteCommandsEnabled(enabled: boolean): Promise<boolean> {
  await updateSettings((current) => ({ ...current, remoteCommandsEnabled: enabled }));
  return await readRemoteCommandsEnabled();
}

/**
 * Remote commands on the target machine:
 * - `DAEMON_MACHINE_COMMAND_RUN`: an agent on another machine of the account asks this daemon to run a
 *   shell command. Refused unless remote commands are on here; the working directory goes through the
 *   machine's filesystem access policy, and the command runs through the same executor as the machine
 *   `bash` RPC.
 * - `DAEMON_MACHINE_COMMAND_SETTINGS_GET` / `_SET`: the app's machine screen reads and changes the switch.
 */
export function registerMachineCommandHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  workingDirectory: string;
  accessPolicy: FilesystemAccessPolicy;
}>): void {
  const defaultDirectory = resolveFilesystemPolicyDefaultDirectory({
    defaultDirectory: params.workingDirectory,
    accessPolicy: params.accessPolicy,
  });

  params.rpcHandlerManager.registerHandler<unknown, MachineCommandRunResponse>(
    RPC_METHODS.DAEMON_MACHINE_COMMAND_RUN,
    async (raw) => {
      if (!(await readRemoteCommandsEnabled())) {
        return { success: false, errorCode: 'remote_commands_disabled', error: REMOTE_COMMANDS_DISABLED_MESSAGE };
      }
      const parsed = MachineCommandRunRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return { success: false, errorCode: 'invalid_request', error: 'Invalid remote command request' };
      }

      const requestedCwd = parsed.data.cwd ? expandHomeDirPath(parsed.data.cwd) : defaultDirectory;
      const cwd = authorizeFilesystemPath({
        targetPath: requestedCwd,
        defaultDirectory,
        accessPolicy: params.accessPolicy,
      });
      if (!cwd.valid) {
        return { success: false, errorCode: 'cwd_not_allowed', error: cwd.error };
      }

      const result = await executeShellCommandRequest(
        { command: parsed.data.command, ...(parsed.data.timeoutMs ? { timeout: parsed.data.timeoutMs } : {}) },
        cwd.resolvedPath,
      );
      logger.infoFile('[MACHINE COMMAND] Ran a remote command', {
        cwd: cwd.resolvedPath,
        commandLength: parsed.data.command.length,
        exitCode: result.exitCode,
      });
      return result;
    },
  );

  params.rpcHandlerManager.registerHandler<unknown, MachineCommandSettingsResponse>(
    RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_GET,
    async () => ({ remoteCommandsEnabled: await readRemoteCommandsEnabled() }),
  );

  params.rpcHandlerManager.registerHandler<unknown, MachineCommandSettingsResponse>(
    RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_SET,
    async (raw) => {
      const parsed = MachineCommandSettingsSetRequestSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error('Invalid remote command settings request');
      }
      const enabled = await writeRemoteCommandsEnabled(parsed.data.enabled);
      logger.infoFile(`[MACHINE COMMAND] Remote commands turned ${enabled ? 'on' : 'off'} from the app`);
      return { remoteCommandsEnabled: enabled };
    },
  );
}
