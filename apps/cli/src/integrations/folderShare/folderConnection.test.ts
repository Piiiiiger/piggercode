import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { openFolderConnection, type FolderConnectionTarget } from './folderConnection';

/** A started process as the connection sees it: pipes, exit and kill, with what was written recorded. */
class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdio: PassThrough[];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killed: NodeJS.Signals[] = [];
  readonly received: Buffer[] = [];

  constructor(readonly command: string, readonly args: readonly string[], extraFds: number) {
    super();
    this.stdio = [this.stdin, this.stdout, this.stderr, ...Array.from({ length: extraFds }, () => new PassThrough())];
    this.stdin.on('data', (chunk: Buffer) => this.received.push(chunk));
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed.push(signal);
    this.exit(null, signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

const TARGET: FolderConnectionTarget = {
  folder: 'code/my app',
  folderPath: '/home/pigger/code/my app',
  homeDir: '/home/pigger',
  server: { user: 'pigger', host: 'server.example.test', port: 2200 },
  keyPath: '/state/id_ed25519',
  knownHostsPath: '/state/known_hosts',
  tools: { ssh: 'ssh', sftpServer: '/usr/lib/ssh/sftp-server', bwrap: 'bwrap' },
};

function open() {
  const processes: FakeProcess[] = [];
  const events = { connected: 0, closed: [] as string[] };
  const connection = openFolderConnection(TARGET, {
    onConnected: () => {
      events.connected += 1;
    },
    onClosed: (reason) => {
      events.closed.push(reason);
    },
  }, {
    spawnPiped: (command, args, extraFds) => {
      const child = new FakeProcess(command, args, extraFds);
      processes.push(child);
      return child as unknown as ChildProcess;
    },
    identity: { passwd: 'pigger:x:1000:1000::/home/pigger:/bin/bash\n', group: 'pigger:x:1000:\n' },
  });
  const [sftp, ssh] = processes as [FakeProcess, FakeProcess];
  return { connection, sftp, ssh, events };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('one shared folder’s connection', () => {
  it('serves only the shared folder, from a sandbox, to the server’s mount request for it', async () => {
    const { sftp, ssh, connection } = open();
    let passwd = '';
    sftp.stdio[3]!.on('data', (chunk: Buffer) => {
      passwd += chunk.toString();
    });
    await settle();

    expect(sftp.command).toBe('bwrap');
    expect(sftp.args).toEqual(expect.arrayContaining(['--unshare-all', '--die-with-parent']));
    const bind = sftp.args.indexOf('--bind');
    expect(sftp.args.slice(bind, bind + 3)).toEqual(['--bind', TARGET.folderPath, TARGET.folderPath]);
    expect(sftp.args.filter((arg) => arg === '--bind')).toHaveLength(1);
    expect(sftp.args.slice(-3)).toEqual(['/usr/lib/ssh/sftp-server', '-d', '/home/pigger']);
    expect(passwd).toBe('pigger:x:1000:1000::/home/pigger:/bin/bash\n');

    expect(ssh.command).toBe('ssh');
    expect(ssh.args).toEqual(expect.arrayContaining(['-i', '/state/id_ed25519', 'StrictHostKeyChecking=yes', '-p', '2200']));
    expect(ssh.args.slice(-2)).toEqual(['pigger@server.example.test', 'mount code/my app']);
    connection.close();
  });

  it('carries the server’s requests to sftp-server and its answers back, connected from the first answer', async () => {
    const { sftp, ssh, events, connection } = open();

    ssh.stdout.write('init from the server');
    sftp.stdout.write('version answer');
    await settle();

    expect(Buffer.concat(sftp.received).toString()).toBe('init from the server');
    expect(Buffer.concat(ssh.received).toString()).toBe('version answer');
    expect(events.connected).toBe(1);
    connection.close();
  });

  it('ends both sides when one ends, with the last thing the server or sandbox said', async () => {
    const { sftp, ssh, events } = open();
    ssh.stderr.write('piggercode shared folders: /home/pigger/local/laptop/code on the server is not empty, so nothing is mounted over it\n');
    await settle();

    ssh.exit(3);

    expect(events.closed).toEqual(['piggercode shared folders: /home/pigger/local/laptop/code on the server is not empty, so nothing is mounted over it']);
    expect(sftp.killed).toEqual(['SIGTERM']);
    expect(events.connected).toBe(0);
  });

  it('reports a dropped connection after it was connected, and nothing at all after it is closed on purpose', async () => {
    const dropped = open();
    dropped.sftp.stdout.write('version answer');
    await settle();
    dropped.ssh.exit(255);
    expect(dropped.events.closed).toEqual(['The connection to the server was lost.']);

    const closed = open();
    closed.connection.close();
    expect(closed.sftp.killed).toEqual(['SIGTERM']);
    expect(closed.ssh.killed).toEqual(['SIGTERM']);
    expect(closed.events.closed).toEqual([]);
  });
});
