import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { ensureSharedFoldersKey } from './computerKey';
import { buildServerSshArgs, type FolderConnectionTarget } from './folderConnection';
import { SHELL_REQUEST } from './shellServe';

/**
 * One spare shell connection from this computer to a server it shares folders with (`shellServe.ts`
 * is the other end): `ssh <server> shell`, which announces this computer's user and host key, takes
 * the server's client key, and then waits. When `ssh <computer>` on the server opens it, this starts a
 * user-level `sshd -i` (no Remote Login, nothing listening here) for that one SSH connection, if
 * remote commands are still on: they are what lets the account's other machines run commands here.
 */

export type ShellLinkTarget = Readonly<{
  server: FolderConnectionTarget['server'];
  keyPath: string;
  knownHostsPath: string;
  ssh: string;
  sshd: string;
  /** This computer's login name: the user-level sshd logs in only as the user it runs as. */
  user: string;
  /** The user-level sshd's host key and config (`ensureComputerShellFiles`). */
  shell: ComputerShellFiles;
  /** Where this server's client key goes, the only key that may log in through this link. */
  authorizedKeysPath: string;
}>;

export type ShellLinkStage = 'announce' | 'waiting' | 'in_use';

export type ShellLinkEvents = Readonly<{
  /** The server answered: the link waits there for `ssh`. */
  onReady: () => void;
  /** `ssh` on the server opened it; from now on it carries that one SSH connection. */
  onInUse: () => void;
  /** Called once when the link ends by itself (not after `close()`), with the stage it had reached. */
  onClosed: (reason: string, stage: ShellLinkStage) => void;
}>;

export type ShellLink = Readonly<{ close: () => void }>;

export type SpawnShellProcess = (command: string, args: readonly string[]) => ChildProcess;

const CLIENT_KEY = /^(ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-rsa) [A-Za-z0-9+/]+={0,2}$/;
const MAX_LINE_BYTES = 8 * 1024;

export function openShellLink(
  target: ShellLinkTarget,
  events: ShellLinkEvents,
  deps: Readonly<{
    /** Whether this computer still lets other machines run commands (checked when the server uses the link). */
    mayServe: () => Promise<boolean>;
    spawnProcess?: SpawnShellProcess;
  }>,
): ShellLink {
  const spawnProcess = deps.spawnProcess ?? ((command, args) => spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] }));
  let stage: ShellLinkStage = 'announce';
  let finished = false;
  let starting = false;
  let lastError = '';
  let buffered = Buffer.alloc(0);
  let authorized: Promise<void> | null = null;
  let sshd: ChildProcess | null = null;

  const ssh = spawnProcess(target.ssh, buildServerSshArgs(target, SHELL_REQUEST));
  const finish = (reason: string | null) => {
    if (finished) return;
    finished = true;
    for (const child of [ssh, sshd]) {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
    if (reason !== null) events.onClosed(reason, stage);
  };
  const closedReason = () => lastError || (stage === 'announce'
    ? 'The server did not answer the shell request.'
    : 'The connection to the server was lost.');

  const startShell = async () => {
    stage = 'in_use';
    events.onInUse();
    try {
      await authorized;
    } catch (error) {
      finish(`Could not keep the server's key: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!(await deps.mayServe())) {
      finish('Remote commands are off on this computer, so the server cannot open a shell here.');
      return;
    }
    if (finished) return;
    ssh.stdout?.removeListener('data', onData);
    const shellProcess = spawnProcess(target.sshd, [
      '-i', '-e',
      '-f', target.shell.configPath,
      '-o', `AuthorizedKeysFile=${target.authorizedKeysPath}`,
    ]);
    sshd = shellProcess;
    keepLastLine(shellProcess.stderr, (line) => {
      lastError = line;
    });
    shellProcess.once('error', (error) => finish(`Cannot run ${target.sshd}: ${error.message}`));
    shellProcess.once('close', () => finish(closedReason()));
    shellProcess.stdin?.on('error', () => undefined);
    if (buffered.length > 0) shellProcess.stdin?.write(buffered);
    (ssh.stdout as Readable | null)?.pipe(shellProcess.stdin as Writable);
    (shellProcess.stdout as Readable | null)?.pipe(ssh.stdin as Writable);
  };

  function onData(chunk: Buffer) {
    buffered = Buffer.concat([buffered, chunk]);
    if (stage === 'announce') {
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) {
        if (buffered.length > MAX_LINE_BYTES) finish('The server answered the shell request with something else.');
        return;
      }
      const clientKey = buffered.subarray(0, newline).toString('utf8').trim();
      buffered = buffered.subarray(newline + 1);
      if (!CLIENT_KEY.test(clientKey)) {
        finish('The server answered the shell request with something else.');
        return;
      }
      stage = 'waiting';
      authorized = writeFile(target.authorizedKeysPath, `${clientKey}\n`, { mode: 0o600 });
      authorized.then(() => {
        if (!finished && stage === 'waiting') events.onReady();
      }, () => undefined);
    }
    if (stage === 'waiting' && buffered.length > 0 && !starting) {
      starting = true;
      void startShell();
    }
  }

  keepLastLine(ssh.stderr, (line) => {
    lastError = line;
  });
  ssh.once('error', (error) => finish(`Cannot run ${target.ssh}: ${error.message}`));
  ssh.once('close', () => finish(closedReason()));
  ssh.stdin?.on('error', () => undefined);
  ssh.stdout?.on('data', onData);
  ssh.stdin?.write(`${target.user} ${target.shell.hostPublicKey}\n`);

  return { close: () => finish(null) };
}

function keepLastLine(stream: Readable | null | undefined, keep: (line: string) => void): void {
  stream?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) keep(lines[lines.length - 1]!);
  });
}

export type ComputerShellFiles = Readonly<{ configPath: string; hostPublicKey: string }>;

/**
 * The user-level sshd's own files in `<shellDir>`: its host key (made once) and its config. It runs
 * only as a pipe to one server connection, as this user, with keys only; `PATH` adds Homebrew's
 * folders on macOS, where a non-login shell would not have them.
 */
export async function ensureComputerShellFiles(params: Readonly<{
  shellDir: string;
  platform: NodeJS.Platform;
  sftpServer: string | null;
}>): Promise<ComputerShellFiles> {
  await mkdir(params.shellDir, { recursive: true, mode: 0o700 });
  const hostKey = await ensureSharedFoldersKey(join(params.shellDir, 'host'));
  const lines = [
    '# Written by PiggerCode: the shell a server this computer shares folders with opens through it.',
    `HostKey "${hostKey.keyPath}"`,
    'PidFile none',
    'UsePAM no',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes',
    'AllowAgentForwarding no',
    'X11Forwarding no',
    'PermitUserEnvironment no',
    ...(params.platform === 'darwin'
      ? ['SetEnv PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin']
      : []),
    ...(params.sftpServer ? [`Subsystem sftp ${params.sftpServer}`] : []),
    '',
  ];
  const configPath = join(params.shellDir, 'sshd_config');
  await writeFile(configPath, lines.join('\n'), { mode: 0o600 });
  return { configPath, hostPublicKey: hostKey.publicKey };
}
