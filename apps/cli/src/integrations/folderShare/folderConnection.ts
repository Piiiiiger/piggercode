import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import { buildSandboxedSftpServer, type SharingTools } from './sharingTools';

/**
 * One shared folder's connection: this computer's sandboxed sftp-server on one end, an SSH session to
 * the server running `mount <folder>` (its forced command for this computer's key, see `serve.ts`) on
 * the other. The server's sshfs talks to sftp-server through it. It counts as connected once sftp-server
 * has answered the server, and it ends when either side ends, with the last error either side wrote.
 */

export type FolderConnectionTarget = Readonly<{
  /** The folder relative to the home, as the server asks for it. */
  folder: string;
  /**
   * Where the server mounts it, relative to the server's home, as the server agreed (`serverLocation.ts`);
   * unset for a share from before places, which the server mounts under `~/local`.
   */
  at?: string;
  folderPath: string;
  homeDir: string;
  server: Readonly<{ user: string; host: string; port: number }>;
  keyPath: string;
  knownHostsPath: string;
  tools: SharingTools;
}>;

export type FolderConnectionEvents = Readonly<{
  onConnected: () => void;
  /** Called once when the connection ends by itself; not after `close()`. */
  onClosed: (reason: string) => void;
}>;

export type FolderConnection = Readonly<{ close: () => void }>;

/** Starts a process with pipes on stdin, stdout and stderr, plus `extraFds` more pipes after them. */
export type SpawnPiped = (command: string, args: readonly string[], extraFds: number) => ChildProcess;

/**
 * How long SSH waits on a silent server: 3 keepalives 15 s apart, so a connection that died with the
 * network (sleep, a new Wi-Fi) is noticed within about 45 s and the share reconnects.
 */
const KEEPALIVE_ARGS = ['-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];

export function buildFolderConnectionSshArgs(target: FolderConnectionTarget): string[] {
  // `mount <folder><TAB><place>`: neither may hold a control character, so the tab parts them
  // (a server before places refuses it as a folder name; `serve.ts`).
  return buildServerSshArgs(target, target.at === undefined ? `mount ${target.folder}` : `mount ${target.folder}\t${target.at}`);
}

/** `ssh` to the server with this computer's key, asking its forced command for `request`. */
export function buildServerSshArgs(
  target: Readonly<{ server: FolderConnectionTarget['server']; keyPath: string; knownHostsPath: string }>,
  request: string,
): string[] {
  return [
    '-F', '/dev/null', '-T',
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-i', target.keyPath,
    '-o', `UserKnownHostsFile="${target.knownHostsPath}"`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'StrictHostKeyChecking=yes',
    ...KEEPALIVE_ARGS,
    '-o', 'ClearAllForwardings=yes',
    '-o', 'LogLevel=ERROR',
    '-p', String(target.server.port),
    `${target.server.user}@${target.server.host}`,
    request,
  ];
}

export function openFolderConnection(
  target: FolderConnectionTarget,
  events: FolderConnectionEvents,
  deps: Readonly<{ spawnPiped?: SpawnPiped; identity?: Readonly<{ passwd: string; group: string }> }> = {},
): FolderConnection {
  const spawnPiped = deps.spawnPiped ?? spawnWithPipes;
  const identity = deps.identity;
  let connected = false;
  let finished = false;
  let lastError = '';

  const server = buildSandboxedSftpServer({
    tools: target.tools,
    folderPath: target.folderPath,
    homeDir: target.homeDir,
    ...(identity ? { identity: () => identity } : {}),
  });
  const sftp = spawnPiped(server.command, server.args, server.extraInputs.length);
  const ssh = spawnPiped(target.tools.ssh, buildFolderConnectionSshArgs(target), 0);

  const finish = (reason: string | null) => {
    if (finished) return;
    finished = true;
    for (const child of [sftp, ssh]) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    if (reason !== null) events.onClosed(reason);
  };
  const closedReason = () => lastError
    || (connected ? 'The connection to the server was lost.' : 'The server closed the connection.');

  for (const child of [sftp, ssh]) {
    child.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length > 0) lastError = lines[lines.length - 1]!;
    });
    child.once('error', (error) => {
      lastError = `Cannot run ${child === sftp ? server.command : target.tools.ssh}: ${error.message}`;
      finish(lastError);
    });
    // `close`, not `exit`: it comes after the child's output is read, so the server's last word (why it
    // did not mount) is in `lastError` by then.
    child.once('close', () => finish(closedReason()));
    // A side that ends first leaves the other writing into a closed pipe; that is the end, not a crash.
    child.stdin?.on('error', () => undefined);
  }

  server.extraInputs.forEach((text, index) => writeAndClose(sftp.stdio[3 + index] as Writable | null | undefined, text));
  sftp.stdout?.once('data', () => {
    connected = true;
    if (!finished) events.onConnected();
  });
  (sftp.stdout as Readable | null)?.pipe(ssh.stdin as Writable);
  (ssh.stdout as Readable | null)?.pipe(sftp.stdin as Writable);

  return { close: () => finish(null) };
}

function writeAndClose(stream: Writable | null | undefined, text: string): void {
  if (!stream) return;
  stream.on('error', () => undefined);
  stream.end(text);
}

function spawnWithPipes(command: string, args: readonly string[], extraFds: number): ChildProcess {
  const stdio = Array.from({ length: 3 + extraFds }, () => 'pipe' as const);
  return spawn(command, [...args], { stdio });
}
