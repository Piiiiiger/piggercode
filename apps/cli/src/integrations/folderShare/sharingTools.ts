import { accessSync, constants, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { userInfo } from 'node:os';

import { commandExistsInPath } from '@/daemon/service/commandExistsInPath';

/**
 * What a computer needs to share folders: `ssh` to reach the server, `sftp-server` to serve the folder,
 * and bubblewrap to run sftp-server in a sandbox in which the shared folder is the only part of the
 * computer's files that exists. Linux only for now: macOS has no bubblewrap and needs its own sandbox.
 */

export type SharingTools = Readonly<{ ssh: string; sftpServer: string; bwrap: string }>;

export type SharingToolsResult =
  | Readonly<{ ok: true; tools: SharingTools }>
  | Readonly<{ ok: false; reason: string }>;

const SFTP_SERVER_PATHS = [
  '/usr/lib/ssh/sftp-server',
  '/usr/lib/openssh/sftp-server',
  '/usr/libexec/openssh/sftp-server',
  '/usr/libexec/sftp-server',
];

/** Top-level system folders sftp-server's loader may need; recreated in the sandbox as they are here. */
const SYSTEM_ROOT_ENTRIES = ['/bin', '/sbin', '/lib', '/lib32', '/lib64'];

export function resolveSharingTools(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): SharingToolsResult {
  if (platform !== 'linux') {
    return { ok: false, reason: 'Sharing folders works on Linux computers for now.' };
  }
  const onPath = (cmd: string) => commandExistsInPath({ cmd, envPath: env.PATH, platform });
  const sftpServer = SFTP_SERVER_PATHS.find(isExecutable);
  if (!onPath('ssh') || !sftpServer) {
    return { ok: false, reason: 'Install OpenSSH (the ssh client and sftp-server) on this computer to share folders.' };
  }
  if (!onPath('bwrap')) {
    return {
      ok: false,
      reason: 'Install bubblewrap on this computer to share folders. It keeps the server inside the folders you share.',
    };
  }
  return { ok: true, tools: { ssh: 'ssh', sftpServer, bwrap: 'bwrap' } };
}

/**
 * bubblewrap arguments that run sftp-server with only `folderPath` of the computer's files: system
 * files read-only, no network, no other processes, its own user and group only (passed on fds 3 and 4,
 * see `sandboxIdentity`). sftp-server starts in `homeDir`, so the server asks for the folder by its path
 * relative to the home.
 */
export function buildSandboxedSftpServerArgs(params: Readonly<{
  folderPath: string;
  homeDir: string;
  sftpServer: string;
  describeRootEntry?: (path: string) => RootEntry;
}>): string[] {
  const describe = params.describeRootEntry ?? describeRootEntry;
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr', '--dev', '/dev'];
  for (const entry of SYSTEM_ROOT_ENTRIES) {
    const kind = describe(entry);
    if (kind.type === 'link') args.push('--symlink', kind.target, entry);
    else if (kind.type === 'dir') args.push('--ro-bind', entry, entry);
  }
  args.push(
    '--ro-bind-data', '3', '/etc/passwd',
    '--ro-bind-data', '4', '/etc/group',
    '--bind', params.folderPath, params.folderPath,
    params.sftpServer, '-d', params.homeDir,
  );
  return args;
}

export type RootEntry = Readonly<{ type: 'link'; target: string }> | Readonly<{ type: 'dir' }> | Readonly<{ type: 'none' }>;

function describeRootEntry(path: string): RootEntry {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { type: 'link', target: readlinkSync(path) };
    return stat.isDirectory() ? { type: 'dir' } : { type: 'none' };
  } catch {
    return { type: 'none' };
  }
}

/** The sandbox's /etc/passwd and /etc/group: this user and its group, which sftp-server needs to start. */
export function sandboxIdentity(): Readonly<{ passwd: string; group: string }> {
  const user = userInfo();
  const groupName = readGroupName(user.gid) ?? user.username;
  return {
    passwd: `${user.username}:x:${user.uid}:${user.gid}::${user.homedir}:${user.shell ?? '/bin/sh'}\n`,
    group: `${groupName}:x:${user.gid}:\n`,
  };
}

function readGroupName(gid: number): string | null {
  try {
    for (const line of readFileSync('/etc/group', 'utf8').split('\n')) {
      const [name, , id] = line.split(':');
      if (name && id === String(gid)) return name;
    }
  } catch {
    // No /etc/group: the user's own name stands in for the group's.
  }
  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
