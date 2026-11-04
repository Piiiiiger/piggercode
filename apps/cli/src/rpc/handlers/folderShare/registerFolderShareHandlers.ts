import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  FolderShareAcceptResponseSchema,
  FolderShareAddRequestSchema,
  FolderShareRemoveRequestSchema,
  type FolderShareAcceptResponse,
  type FolderShareListResponse,
  type FolderShareMutationResponse,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { configuration } from '@/configuration';
import { answerFolderShareAccept } from '@/integrations/folderShare/acceptRequest';
import { createComputerShares, type AcceptOnServer, type ComputerShares } from '@/integrations/folderShare/computerShares';
import type { Credentials } from '@/persistence';
import { callMachineRpc } from '@/session/transport/rpc/machineRpc';
import { logger } from '@/ui/logger';

/**
 * Shared folders on this machine's daemon (`folderShare.ts` in the protocol). As a computer, the app's
 * machine screen lists, adds and removes the folders it shares; `computerShares.ts` owns them and their
 * connections, which start with this registration and end when it is disposed. As a server, other
 * machines of the account ask it to accept their key (`acceptRequest.ts`).
 */
export function registerFolderShareHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  machineId: string;
  machineName: string;
  /** The account credentials this daemon reaches other machines with; null leaves servers unreachable. */
  credentials: Credentials | null;
  /** Test seam: the computer's shares, instead of the ones kept in this machine's settings. */
  shares?: ComputerShares;
}>): Readonly<{ dispose: () => Promise<void> }> {
  // Made on first use, after the daemon's configuration is in place, not while it is being built.
  let created: ComputerShares | null = params.shares ?? null;
  const shares = (): ComputerShares => created ??= createComputerShares({
    machineId: params.machineId,
    machineName: params.machineName,
    homeDir: realHomeDir(),
    stateDir: join(configuration.happyHomeDir, 'shared-folders'),
    acceptOnServer: createAcceptOnServer(params.credentials),
  });

  params.rpcHandlerManager.registerHandler<unknown, FolderShareListResponse>(
    RPC_METHODS.DAEMON_FOLDER_SHARE_LIST,
    async () => await shares().list(),
  );
  params.rpcHandlerManager.registerHandler<unknown, FolderShareMutationResponse>(
    RPC_METHODS.DAEMON_FOLDER_SHARE_ADD,
    async (raw) => {
      const parsed = FolderShareAddRequestSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, errorCode: 'invalid_request', error: 'Invalid shared-folder request.' };
      return await shares().add(parsed.data);
    },
  );
  params.rpcHandlerManager.registerHandler<unknown, FolderShareMutationResponse>(
    RPC_METHODS.DAEMON_FOLDER_SHARE_REMOVE,
    async (raw) => {
      const parsed = FolderShareRemoveRequestSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, errorCode: 'invalid_request', error: 'Invalid shared-folder request.' };
      return await shares().remove(parsed.data);
    },
  );
  params.rpcHandlerManager.registerHandler<unknown, FolderShareAcceptResponse>(
    RPC_METHODS.DAEMON_FOLDER_SHARE_ACCEPT,
    async (raw) => {
      const answer = await answerFolderShareAccept(raw);
      logger.infoFile(answer.ok
        ? '[SHARED FOLDERS] Accepted a computer’s key for shared folders'
        : `[SHARED FOLDERS] Declined shared folders: ${answer.errorCode}`);
      return answer;
    },
  );

  void Promise.resolve()
    .then(() => shares().start())
    .catch((error) => {
      logger.debug('[SHARED FOLDERS] Could not start the shared folders', { error: String(error) });
    });
  return {
    dispose: async () => {
      created?.stop();
    },
  };
}

function createAcceptOnServer(credentials: Credentials | null): AcceptOnServer {
  return async (serverMachineId, request) => {
    if (!credentials) return 'unavailable';
    let response: unknown;
    try {
      response = await callMachineRpc({
        credentials,
        machineId: serverMachineId,
        method: RPC_METHODS.DAEMON_FOLDER_SHARE_ACCEPT,
        request,
      });
    } catch (error) {
      logger.debug('[SHARED FOLDERS] The server did not answer', { error: String(error) });
      return 'unavailable';
    }
    // A server without this method (older PiggerCode) answers with something else.
    const parsed = FolderShareAcceptResponseSchema.safeParse(response);
    return parsed.success ? parsed.data : 'unavailable';
  };
}

function realHomeDir(): string {
  try {
    return realpathSync(homedir());
  } catch {
    return homedir();
  }
}
