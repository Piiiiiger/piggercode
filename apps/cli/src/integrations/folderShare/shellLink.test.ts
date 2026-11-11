import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openShellLink, type ShellLinkEvents, type ShellLinkTarget } from './shellLink';

const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINQKK0TckxnFot3LMp0B+2WElapYHkD6E8fo78SadK/n';
const CLIENT_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A process at the OS boundary: its pipes, its exit, and what was written to it. */
function fakeProcess(command: string, args: readonly string[]) {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: Buffer[] = [];
  stdin.on('data', (chunk: Buffer) => written.push(chunk));
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((signal?: NodeJS.Signals) => {
      child.signalCode = signal ?? 'SIGTERM';
      emitter.emit('close', null, child.signalCode);
      return true;
    }),
  });
  return { command, args, child: child as unknown as ChildProcess, written: () => Buffer.concat(written).toString('utf8'), stdout, stderr };
}

function setup(options: Readonly<{ mayServe?: boolean }> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc-shell-link-'));
  directories.push(dir);
  const processes: Array<ReturnType<typeof fakeProcess>> = [];
  const events = { onReady: vi.fn(), onInUse: vi.fn(), onClosed: vi.fn() } satisfies ShellLinkEvents;
  const target: ShellLinkTarget = {
    server: { user: 'pigger', host: 'server.example.test', port: 2222 },
    keyPath: join(dir, 'id_ed25519'),
    knownHostsPath: join(dir, 'known_hosts'),
    ssh: 'ssh',
    sshd: '/usr/sbin/sshd',
    user: 'pigger',
    shell: { configPath: join(dir, 'sshd_config'), hostPublicKey: HOST_KEY },
    authorizedKeysPath: join(dir, 'authorized_keys.server'),
  };
  const link = openShellLink(target, events, {
    mayServe: async () => options.mayServe ?? true,
    spawnProcess: (command, args) => {
      const process = fakeProcess(command, args);
      processes.push(process);
      return process.child;
    },
  });
  return { dir, target, events, link, processes };
}

describe('a computer\'s spare shell connection to its server', () => {
  it('announces this computer, keeps only the server\'s key, and starts sshd for the ssh that uses it', async () => {
    const { target, events, processes } = setup();
    const [ssh] = processes;
    expect(ssh!.args.at(-1)).toBe('shell');
    expect(ssh!.written()).toBe(`pigger ${HOST_KEY}\n`);

    ssh!.stdout.write(`${CLIENT_KEY}\n`);
    await vi.waitFor(() => expect(events.onReady).toHaveBeenCalled());
    expect(readFileSync(target.authorizedKeysPath, 'utf8')).toBe(`${CLIENT_KEY}\n`);
    expect(processes).toHaveLength(1);

    ssh!.stdout.write('SSH-2.0-client\r\n');
    await vi.waitFor(() => expect(processes).toHaveLength(2));
    const sshd = processes[1]!;
    expect(events.onInUse).toHaveBeenCalled();
    expect(sshd.command).toBe('/usr/sbin/sshd');
    expect(sshd.args).toEqual(['-i', '-e', '-f', target.shell.configPath, '-o', `AuthorizedKeysFile=${target.authorizedKeysPath}`]);
    await vi.waitFor(() => expect(sshd.written()).toBe('SSH-2.0-client\r\n'));

    sshd.stdout.write('SSH-2.0-OpenSSH\r\n');
    await vi.waitFor(() => expect(ssh!.written()).toBe(`pigger ${HOST_KEY}\nSSH-2.0-OpenSSH\r\n`));

    sshd.child.emit('close', 0, null);
    expect(events.onClosed).toHaveBeenCalledWith(expect.any(String), 'in_use');
    expect(ssh!.child.kill).toHaveBeenCalled();
  });

  it('opens no shell once remote commands are off, even on a spare made while they were on', async () => {
    const { events, processes } = setup({ mayServe: false });
    const [ssh] = processes;
    ssh!.stdout.write(`${CLIENT_KEY}\nSSH-2.0-client\r\n`);
    await vi.waitFor(() => expect(events.onClosed).toHaveBeenCalled());
    expect(events.onClosed.mock.calls[0]![0]).toContain('Remote commands are off');
    expect(processes).toHaveLength(1);
  });

  it('ends at once when the server answers the shell request with something else', async () => {
    const { events, processes } = setup();
    processes[0]!.stderr.write('piggercode shared folders: this key can only mount a folder inside your home\n');
    await new Promise((resolve) => setImmediate(resolve));
    processes[0]!.child.emit('close', 2, null);
    expect(events.onClosed).toHaveBeenCalledWith('piggercode shared folders: this key can only mount a folder inside your home', 'announce');
  });

  it('tells a connection that failed before the server could answer from a server that refused', async () => {
    // ssh exits 255 for its own failures (network gone, timed out, closed while connecting): the server said nothing.
    const { events, processes } = setup();
    processes[0]!.stderr.write('ssh: connect to host server.example.test port 2200: Connection timed out\n');
    await new Promise((resolve) => setImmediate(resolve));
    processes[0]!.child.emit('close', 255, null);
    expect(events.onClosed).toHaveBeenCalledWith('ssh: connect to host server.example.test port 2200: Connection timed out', 'unreachable');
  });
});
