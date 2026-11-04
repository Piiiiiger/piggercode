import { describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import type { ComputerShares } from '@/integrations/folderShare/computerShares';

import { registerFolderShareHandlers } from './registerFolderShareHandlers';

type Handler = (data: unknown) => Promise<unknown>;

function register() {
  const handlers = new Map<string, Handler>();
  const registrar: RpcHandlerRegistrar = {
    registerHandler(method, handler) {
      handlers.set(method, handler as Handler);
    },
  };
  const calls: string[] = [];
  const shares: ComputerShares = {
    start: async () => {
      calls.push('start');
    },
    list: async () => ({ shares: [] }),
    add: async (request) => {
      calls.push(`add ${request.folder} ${request.serverMachineId}`);
      return { ok: true, shares: [] };
    },
    remove: async (request) => {
      calls.push(`remove ${request.folder} ${request.serverMachineId}`);
      return { ok: true, shares: [] };
    },
    stop: () => {
      calls.push('stop');
    },
  };
  const registration = registerFolderShareHandlers({
    rpcHandlerManager: registrar,
    machineId: 'machine-laptop',
    machineName: 'laptop',
    credentials: null,
    shares,
  });
  const call = (method: string, data: unknown) => {
    const handler = handlers.get(method);
    if (!handler) throw new Error(`${method} was not registered`);
    return handler(data);
  };
  return { call, calls, registration };
}

describe('shared folders on this machine’s daemon', () => {
  it('starts the shares with the daemon, hands the app’s requests to them, and stops them with it', async () => {
    const { call, calls, registration } = register();

    expect(await call(RPC_METHODS.DAEMON_FOLDER_SHARE_LIST, {})).toEqual({ shares: [] });
    expect(await call(RPC_METHODS.DAEMON_FOLDER_SHARE_ADD, { folder: '/home/pigger/code', serverMachineId: 'machine-server' })).toEqual({ ok: true, shares: [] });
    expect(await call(RPC_METHODS.DAEMON_FOLDER_SHARE_REMOVE, { folder: 'code', serverMachineId: 'machine-server' })).toEqual({ ok: true, shares: [] });
    await registration.dispose();

    expect(calls).toEqual(['start', 'add /home/pigger/code machine-server', 'remove code machine-server', 'stop']);
  });

  it('answers malformed requests without touching the shares', async () => {
    const { call, calls } = register();

    expect(await call(RPC_METHODS.DAEMON_FOLDER_SHARE_ADD, { folder: '' })).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(await call(RPC_METHODS.DAEMON_FOLDER_SHARE_REMOVE, null)).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(await call(RPC_METHODS.DAEMON_FOLDER_SHARE_ACCEPT, { publicKey: 'x' })).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(calls).toEqual(['start']);
  });
});
