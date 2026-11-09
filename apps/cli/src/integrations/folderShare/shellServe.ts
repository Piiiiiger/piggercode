import { randomBytes } from 'node:crypto';
import { renameSync, symlinkSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { ensureSharedFoldersKey } from './computerKey';
import { COMPUTER_LABEL_PATTERN } from './sharedFolderMounts';

/**
 * `ssh <computer>` on a server, without Remote Login on the computer. A computer that shares folders
 * with this server and has remote commands on keeps one spare connection here, `ssh <server> shell`,
 * with its forced command (`serve.ts`), and starts a user-level `sshd -i` on its end when this server
 * uses it (`shellLink.ts`). On this end, `shell` pins the computer's host key, answers with this
 * server's client key, and waits on a socket only this user can open; `ssh <computer>` reaches it
 * through its ProxyCommand, `piggercode machine shared-folders connect <computer>`. One such connection
 * carries one SSH connection, and every `ssh` makes its own: the computer checks its consent for each.
 */

export const SHELL_REQUEST = 'shell';

/** Where the server keeps its client key, the computers' host keys, the ssh config and the sockets. */
export function serverShellDir(happyHomeDir: string): string {
  return join(happyHomeDir, 'shared-folders', 'shell');
}

export function shellSocketPath(shellDir: string, label: string): string {
  return join(shellDir, `${label}.sock`);
}

/** The alias `ssh` checks the computer's host key under. */
export function shellHostKeyAlias(label: string): string {
  return `piggercode-shell-${label}`;
}

/**
 * The first line each side sends: the computer, `<user> <host key>`; the server, `<client key>`.
 * Both are public keys; the connection itself is already authenticated by the computer's key.
 */
const COMPUTER_LINE = /^([a-z_][a-z0-9._-]{0,31}) ((?:ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-rsa) [A-Za-z0-9+/]+={0,2})$/;
const MAX_LINE_BYTES = 8 * 1024;

export type ShellServeParams = Readonly<{
  label: string;
  shellDir: string;
  /** The ProxyCommand of the computer's alias, a shell command (`buildPiggercodeShellCommand`). */
  connectCommand: string;
  input: Readable;
  output: Writable;
  reportError: (message: string) => void;
  ensureClientKey?: (dir: string) => Promise<Readonly<{ keyPath: string; publicKey: string }>>;
}>;

export async function runSharedFolderShellServe(params: ShellServeParams): Promise<number> {
  if (!COMPUTER_LABEL_PATTERN.test(params.label)) {
    params.reportError('piggercode shared folders: invalid label');
    return 2;
  }
  const socketPath = shellSocketPath(params.shellDir, params.label);
  return await new Promise<number>((resolve) => {
    // announce: reading the computer's line; waiting: on the socket for `ssh`; joined: carrying it.
    // Each spare listens on a socket of its own (closing a listener removes its file by name) and
    // points `<computer>.sock` at it, replacing an older spare's link in one rename. A spare that
    // ended leaves that link dangling, which `connect` waits past until the next spare.
    let phase: 'announce' | 'waiting' | 'joined' | 'done' = 'announce';
    let buffered = Buffer.alloc(0);
    let listener: Server | null = null;

    const finish = (code: number, error?: string) => {
      if (phase === 'done') return;
      phase = 'done';
      if (error) params.reportError(`piggercode shared folders: ${error}`);
      listener?.close();
      params.input.removeListener('data', onData);
      resolve(code);
    };
    const joinSocket = (socket: Socket) => {
      if (phase !== 'waiting') {
        socket.destroy();
        return;
      }
      // One SSH connection per spare: the next `ssh` waits for the computer's next spare.
      phase = 'joined';
      listener?.close();
      params.input.removeListener('data', onData);
      if (buffered.length > 0) socket.write(buffered);
      params.input.pipe(socket);
      socket.pipe(params.output, { end: false });
      socket.once('close', () => {
        phase = 'done';
        resolve(0);
      });
      socket.once('error', () => socket.destroy());
    };
    const wait = async (line: string) => {
      const announced = COMPUTER_LINE.exec(line);
      if (!announced) {
        finish(2, 'the computer did not announce its shell');
        return;
      }
      const [, user, hostKey] = announced as unknown as [string, string, string];
      try {
        await mkdir(params.shellDir, { recursive: true, mode: 0o700 });
        const clientKey = await (params.ensureClientKey ?? ensureSharedFoldersKey)(join(params.shellDir, 'client'));
        await pinHostKey(params.shellDir, params.label, hostKey);
        await writeAliasConfig({ ...params, user, clientKeyPath: clientKey.keyPath });
        if (phase !== 'waiting') return;
        params.output.write(`${clientKey.publicKey}\n`);
        const spareName = `spare-${randomBytes(6).toString('hex')}.sock`;
        listener = createServer(joinSocket);
        listener.once('error', (error) => finish(3, `cannot wait for ssh at ${socketPath}: ${error.message}`));
        listener.listen(join(params.shellDir, spareName), () => {
          if (phase !== 'waiting') return;
          const link = `${socketPath}.${spareName}`;
          try {
            symlinkSync(spareName, link);
            renameSync(link, socketPath);
          } catch (error) {
            finish(3, `cannot offer the shell at ${socketPath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      } catch (error) {
        finish(3, error instanceof Error ? error.message : String(error));
      }
    };
    function onData(chunk: Buffer) {
      buffered = Buffer.concat([buffered, chunk]);
      if (phase !== 'announce') return;
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) {
        if (buffered.length > MAX_LINE_BYTES) finish(2, 'the computer did not announce its shell');
        return;
      }
      const line = buffered.subarray(0, newline).toString('utf8').trim();
      buffered = buffered.subarray(newline + 1);
      phase = 'waiting';
      void wait(line);
    }
    params.input.on('data', onData);
    // The computer went away before anyone used this spare (a joined connection ends with its socket).
    params.input.once('end', () => {
      if (phase !== 'joined') finish(0);
    });
  });
}

/**
 * `piggercode machine shared-folders connect <computer>`, the ProxyCommand of `ssh <computer>`: joins
 * this process's stdin and stdout to the computer's spare connection. Right after one is used the
 * computer opens the next within moments, and one that dropped is tried again within its retry delay
 * (`RETRY_DELAY_MS` in `computerShares.ts`), so it waits that long for one before giving up.
 */
export async function runSharedFolderShellConnect(params: Readonly<{
  label: string;
  shellDir: string;
  input: Readable;
  output: Writable;
  reportError: (message: string) => void;
  waitMs?: number;
  retryEveryMs?: number;
}>): Promise<number> {
  if (!COMPUTER_LABEL_PATTERN.test(params.label)) {
    params.reportError(`piggercode: no computer named ${params.label}`);
    return 255;
  }
  const socketPath = shellSocketPath(params.shellDir, params.label);
  const deadline = Date.now() + (params.waitMs ?? 15_000);
  for (;;) {
    const socket = await openSocket(socketPath);
    if (socket) {
      return await new Promise<number>((resolve) => {
        params.input.pipe(socket);
        socket.pipe(params.output, { end: false });
        socket.once('close', () => resolve(0));
        socket.once('error', () => resolve(0));
      });
    }
    if (Date.now() >= deadline) {
      params.reportError(
        `piggercode: ${params.label} is not connected. It connects while it shares folders with this machine,`
        + ' is awake, and has remote commands on (piggercode machine remote-commands on).',
      );
      return 255;
    }
    await new Promise((resolve) => setTimeout(resolve, params.retryEveryMs ?? 500));
  }
}

function openSocket(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = connect(path);
    socket.once('connect', () => resolve(socket));
    socket.once('error', () => resolve(null));
  });
}

/** Each computer's host key in a file of its own, so computers connecting at once never drop each other's. */
function knownHostsPath(shellDir: string, label: string): string {
  return join(shellDir, `${label}.known_hosts`);
}

async function pinHostKey(shellDir: string, label: string, hostKey: string): Promise<void> {
  await replaceFile(knownHostsPath(shellDir, label), `${shellHostKeyAlias(label)} ${hostKey}\n`);
}

/**
 * Writes a file `ssh` may be reading at that moment (each spare rewrites them while another spare's
 * connection is checking the host key): a reader sees the old content or the new, never a part.
 */
async function replaceFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

async function writeAliasConfig(params: Readonly<{
  label: string;
  shellDir: string;
  connectCommand: string;
  user: string;
  clientKeyPath: string;
}>): Promise<void> {
  const quoted = (path: string) => `"${path}"`;
  const lines = [
    `# Written by PiggerCode: \`ssh ${params.label}\` opens a shell on that computer (shared folders).`,
    `Host ${params.label}`,
    `  HostName ${params.label}`,
    `  User ${params.user}`,
    `  ProxyCommand ${params.connectCommand}`,
    `  IdentityFile ${quoted(params.clientKeyPath)}`,
    '  IdentitiesOnly yes',
    `  HostKeyAlias ${shellHostKeyAlias(params.label)}`,
    `  UserKnownHostsFile ${quoted(knownHostsPath(params.shellDir, params.label))}`,
    '  StrictHostKeyChecking yes',
    // No master connection, and none inherited from the user's own config: each `ssh` takes a fresh
    // spare, which checks remote commands are on.
    '  ControlMaster no',
    '  ControlPath none',
    '  ServerAliveInterval 15',
    '  ServerAliveCountMax 3',
    '',
  ];
  await replaceFile(join(params.shellDir, `${params.label}.conf`), lines.join('\n'));
  // The one file to Include from ~/.ssh/config; it picks up every computer's alias.
  await replaceFile(join(params.shellDir, 'ssh_config'), `Include ${quoted(join(params.shellDir, '*.conf'))}\n`);
}
