import {
  MachineCommandRunRequestSchema,
  type MachineCommandRunResponse,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { readSettings } from '@/persistence';
import { logger } from '@/ui/logger';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

import { executeShellCommandRequest } from '../bash';
import {
  type FilesystemAccessPolicy,
  resolveFilesystemPolicyDefaultDirectory,
} from '../fileSystem/accessPolicy/filesystemAccessPolicy';
import { authorizeFilesystemPath } from '../fileSystem/accessPolicy/filesystemPathAuthorization';

const REMOTE_COMMANDS_DISABLED_MESSAGE =
  'Remote commands are turned off on this machine. Its owner can allow them with `piggercode machine remote-commands on`.';

/** Whether this machine's owner allowed remote commands here (device-local; off unless explicitly on). */
export async function readRemoteCommandsEnabled(): Promise<boolean> {
  return (await readSettings()).remoteCommandsEnabled === true;
}

/**
 * `machine.command.run` on the target machine: an agent on another machine of the account asks this
 * daemon to run a shell command. Refused unless remote commands are on here; the working directory
 * goes through the machine's filesystem access policy, and the command runs through the same
 * executor as the machine `bash` RPC.
 */
export function registerMachineCommandHandler(params: Readonly<{
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
}
