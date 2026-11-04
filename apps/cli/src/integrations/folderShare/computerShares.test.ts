import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderShareAcceptRequest, FolderShareAcceptResponse } from '@piggercode/protocol';

import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { readSettings } from '@/persistence';

import { createComputerShares, type AcceptOnServer } from './computerShares';
import type { FolderConnectionEvents, FolderConnectionTarget } from './folderConnection';
import type { SharingToolsResult } from './sharingTools';

const COMPUTER_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';
const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINQKK0TckxnFot3LMp0B+2WElapYHkD6E8fo78SadK/n';
const TOOLS: SharingToolsResult = { ok: true, tools: { ssh: 'ssh', sftpServer: '/usr/lib/ssh/sftp-server', bwrap: 'bwrap' } };
const ACCEPTED: FolderShareAcceptResponse = {
  ok: true,
  ssh: { user: 'pigger', host: 'server.example.test', port: 2200, hostKeys: [HOST_KEY] },
  root: '~/local/laptop',
};

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-computer-')));
  directories.push(home);
  mkdirSync(join(home, 'code', 'app'), { recursive: true });
  mkdirSync(join(home, 'notes'));
  writeFileSync(join(home, 'notes', 'todo.txt'), 'x');
  return home;
}

/** The server end (its accept answer) and the connections, recorded instead of reaching a network. */
function createComputer(options: Readonly<{
  accept?: FolderShareAcceptResponse | 'unavailable';
  tools?: SharingToolsResult;
}> = {}) {
  const home = createHome();
  const acceptCalls: Array<Readonly<{ serverMachineId: string; request: FolderShareAcceptRequest }>> = [];
  const connections: Array<{ target: FolderConnectionTarget; events: FolderConnectionEvents; closed: boolean }> = [];
  const acceptOnServer: AcceptOnServer = async (serverMachineId, request) => {
    acceptCalls.push({ serverMachineId, request });
    return options.accept ?? ACCEPTED;
  };
  const shares = createComputerShares({
    machineId: 'machine-laptop',
    machineName: 'laptop',
    homeDir: home,
    stateDir: join(home, '.piggercode-state'),
    acceptOnServer,
    resolveTools: () => options.tools ?? TOOLS,
    ensureKey: async (dir) => ({ keyPath: join(dir, 'id_ed25519'), publicKey: COMPUTER_KEY }),
    openConnection: (target, events) => {
      const connection = { target, events, closed: false };
      connections.push(connection);
      return { close: () => { connection.closed = true; } };
    },
    retryDelayMs: 5,
  });
  return { home, shares, acceptCalls, connections };
}

describe('folders this computer shares with a server', () => {
  it('shares a folder: the server accepts this computer’s key, then the folder connects', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-' }, async () => {
      const { home, shares, acceptCalls, connections } = createComputer();

      const added = await shares.add({ folder: join(home, 'code'), serverMachineId: 'machine-server' });

      expect(acceptCalls).toEqual([{
        serverMachineId: 'machine-server',
        request: { publicKey: COMPUTER_KEY, computerMachineId: 'machine-laptop', computerName: 'laptop' },
      }]);
      expect(added).toEqual({
        ok: true,
        shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/local/laptop/code', state: 'connecting' }],
      });
      expect(connections).toHaveLength(1);
      expect(connections[0]!.target).toMatchObject({
        folder: 'code',
        folderPath: join(home, 'code'),
        homeDir: home,
        server: { user: 'pigger', host: 'server.example.test', port: 2200 },
      });
      expect(readFileSync(connections[0]!.target.knownHostsPath, 'utf8')).toBe(`[server.example.test]:2200 ${HOST_KEY}\n`);

      connections[0]!.events.onConnected();
      expect((await shares.list()).shares[0]).toMatchObject({ folder: 'code', state: 'connected' });
      expect((await readSettings()).sharedFolders).toEqual([{ folder: 'code', serverMachineId: 'machine-server' }]);
      shares.stop();
    });
  });

  it('reconnects by itself after a connection ends, showing why it is not connected meanwhile', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-' }, async () => {
      const { shares, connections } = createComputer();
      await shares.add({ folder: 'code', serverMachineId: 'machine-server' });
      connections[0]!.events.onConnected();

      connections[0]!.events.onClosed('Connection reset by peer');

      expect((await shares.list()).shares[0]).toMatchObject({ state: 'retrying', error: 'Connection reset by peer' });
      await vi.waitFor(() => expect(connections).toHaveLength(2));
      expect((await shares.list()).shares[0]).toMatchObject({ state: 'connecting' });
      expect((await shares.list()).shares[0]!.error).toBeUndefined();
      shares.stop();
    });
  });

  it('stops sharing: the connection ends and the folder leaves the list for good', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-' }, async () => {
      const { shares, connections } = createComputer();
      await shares.add({ folder: 'code', serverMachineId: 'machine-server' });

      const removed = await shares.remove({ folder: 'code', serverMachineId: 'machine-server' });

      expect(removed).toEqual({ ok: true, shares: [] });
      expect(connections[0]!.closed).toBe(true);
      connections[0]!.events.onClosed('closed');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(connections).toHaveLength(1);
      expect((await readSettings()).sharedFolders).toEqual([]);
    });
  });

  it('connects the shares it already has when the daemon starts, and ends them when it stops', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-' }, async () => {
      const first = createComputer();
      await first.shares.add({ folder: 'code', serverMachineId: 'machine-server' });
      first.shares.stop();
      expect(first.connections[0]!.closed).toBe(true);

      const restarted = createComputer();
      await restarted.shares.start();

      expect(restarted.connections.map((connection) => connection.target.folder)).toEqual(['code']);
      expect(restarted.acceptCalls).toEqual([]);
      restarted.shares.stop();
    });
  });

  it('shares only folders inside the home, and nothing that overlaps a folder already shared there', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-' }, async () => {
      const { home, shares, acceptCalls } = createComputer();
      for (const folder of [home, '/', join(home, '..'), join(home, 'missing'), join(home, 'notes', 'todo.txt')]) {
        expect(await shares.add({ folder, serverMachineId: 'machine-server' }), folder).toMatchObject({
          ok: false,
          errorCode: 'folder_not_allowed',
        });
      }
      expect(acceptCalls).toEqual([]);

      await shares.add({ folder: 'code', serverMachineId: 'machine-server' });
      expect(await shares.add({ folder: 'code/app', serverMachineId: 'machine-server' })).toMatchObject({
        ok: false,
        errorCode: 'folder_not_allowed',
        error: expect.stringContaining('~/code'),
      });
      expect(await shares.add({ folder: '~/code', serverMachineId: 'machine-server' })).toMatchObject({ ok: true });
      expect((await shares.list()).shares.map((share) => share.folder)).toEqual(['code']);
      shares.stop();
    });
  });

  it('says why nothing was shared when the server is away, declines, or this computer lacks the tools', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-' }, async () => {
      const away = createComputer({ accept: 'unavailable' });
      expect(await away.shares.add({ folder: 'code', serverMachineId: 'machine-server' })).toMatchObject({
        ok: false,
        errorCode: 'server_unavailable',
      });

      const declined = createComputer({ accept: { ok: false, errorCode: 'sshfs_missing', error: 'sshfs is not installed there.' } });
      expect(await declined.shares.add({ folder: 'code', serverMachineId: 'machine-server' })).toEqual({
        ok: false,
        errorCode: 'server_refused',
        error: 'sshfs is not installed there.',
      });

      const odd = createComputer({ accept: { ...ACCEPTED, ssh: { ...ACCEPTED.ssh, hostKeys: [`${HOST_KEY}\n@revoked * ssh-ed25519 AAAA`] } } as FolderShareAcceptResponse });
      expect(await odd.shares.add({ folder: 'code', serverMachineId: 'machine-server' })).toMatchObject({ ok: false, errorCode: 'server_refused' });

      const unsupported = createComputer({ tools: { ok: false, reason: 'Install bubblewrap on this computer to share folders.' } });
      expect(await unsupported.shares.add({ folder: 'code', serverMachineId: 'machine-server' })).toMatchObject({
        ok: false,
        errorCode: 'unsupported',
      });
      expect(await unsupported.shares.list()).toEqual({ shares: [], unsupported: 'Install bubblewrap on this computer to share folders.' });
      expect(unsupported.acceptCalls).toEqual([]);

      for (const computer of [away, declined, odd, unsupported]) expect(computer.connections).toEqual([]);
      expect((await readSettings()).sharedFolders ?? []).toEqual([]);
    });
  });
});
