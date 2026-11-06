import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `piggercode machine shared-folders serve --label <label>`, the forced command of a computer's key on
 * this server (see `acceptedComputers.ts`). The computer runs `ssh <server> "mount <folder>"` with its
 * sandboxed sftp-server on the other end of the connection; this mounts that folder at
 * `~/local/<label>/<folder>` with sshfs in passive mode, over the same connection, for as long as the
 * connection lasts. Nothing may be written to stdout: stdout is the connection. Errors go to stderr,
 * which the computer shows as the reason a share is not connected.
 */

const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SSHFS_OPTIONS = 'passive,idmap=user,dir_cache=yes,dcache_timeout=10';
/** A mount that does not answer a `stat` within this long is the dead end of a dropped connection. */
const MOUNT_ANSWER_TIMEOUT_MS = 5_000;

export type SharedFoldersServeSystem = Readonly<{
  readMountinfo: () => string;
  /**
   * Whether the mount at `path` answers within MOUNT_ANSWER_TIMEOUT_MS, never waiting longer: a request
   * a dead connection's sshfs already took holds its caller, beyond even SIGKILL, until that connection
   * is aborted, so a probe that does not answer is left behind to end with the abort.
   */
  answers: (path: string) => Promise<boolean>;
  /**
   * Ends the FUSE connection behind a mount (`device` as mountinfo gives it, `0:47`): null once ended,
   * otherwise why it could not be.
   */
  abortConnection: (device: string) => string | null;
  unmount: (path: string) => void;
  /** Runs sshfs with these arguments on this process's stdin and stdout; resolves with its exit code. */
  runSshfs: (args: readonly string[]) => Promise<number>;
  reportError: (message: string) => void;
}>;

export async function runSharedFoldersServe(params: Readonly<{
  label: string;
  originalCommand: string | undefined;
  homeDir: string;
  system?: SharedFoldersServeSystem;
}>): Promise<number> {
  const system = params.system ?? osServeSystem;
  if (!LABEL_PATTERN.test(params.label)) {
    system.reportError('piggercode shared folders: invalid label');
    return 2;
  }
  const folder = parseMountRequest(params.originalCommand);
  if (!folder) {
    system.reportError('piggercode shared folders: this key can only mount a folder inside your home');
    return 2;
  }

  const computerRoot = join(params.homeDir, 'local', params.label);
  const mountPoint = join(computerRoot, folder);
  // This computer's mounts on the way to the folder: the folder itself, or one it lies in (a share since
  // removed). Nothing touches the path while one sits on it: through a dead connection's mount, mkdir
  // fails and a stat waits until that connection is ended. Only mountinfo is read first.
  const inTheWay = parseMountinfo(system.readMountinfo()).filter((mount) => mount.type === 'fuse.sshfs'
    && mount.path.startsWith(`${computerRoot}/`)
    && (mount.path === mountPoint || mountPoint.startsWith(`${mount.path}/`)));
  for (const mounted of inTheWay) {
    if (await system.answers(mounted.path)) {
      system.reportError(`piggercode shared folders: ${mounted.path} is already mounted on the server`);
      return 3;
    }
    // The connection behind it is gone (a network change, a computer asleep) and the mount hangs. End
    // that connection before unmounting: its sshfs, when its transport finally closes, unmounts by path,
    // and would take the new mount with it while anything still held the old one (an agent working in the
    // folder). An aborted connection leaves the path alone (libfuse's fuse_kern_unmount); only an sshfs
    // already exiting before the abort can still unmount it, which ends the new connection, and the
    // computer connects again.
    const notEnded = system.abortConnection(mounted.device);
    if (notEnded !== null) {
      system.reportError(`piggercode shared folders: cannot end the dropped connection's mount at ${mounted.path}: ${notEnded}`);
      return 3;
    }
    system.unmount(mounted.path);
  }
  mkdirSync(mountPoint, { recursive: true });
  if (readdirSync(mountPoint).length > 0) {
    system.reportError(`piggercode shared folders: ${mountPoint} on the server is not empty, so nothing is mounted over it`);
    return 3;
  }
  return await system.runSshfs(['-f', '-o', SSHFS_OPTIONS, `:${folder}`, mountPoint]);
}

/** `mount <folder>` with a folder relative to the computer's home; null for anything else. */
function parseMountRequest(originalCommand: string | undefined): string | null {
  if (!originalCommand?.startsWith('mount ')) return null;
  const folder = originalCommand.slice('mount '.length).replace(/\/+$/, '');
  if (!folder || folder.startsWith('/') || folder.startsWith('-') || /[\x00-\x1f\x7f]/.test(folder)) return null;
  const segments = folder.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return folder;
}

/** The shared folders mounted under `~/local` right now (sshfs mounts there), from mountinfo. */
export function listSharedFolderMounts(homeDir: string, mountinfo: string = osServeSystem.readMountinfo()): string[] {
  const root = `${join(homeDir, 'local')}/`;
  return parseMountinfo(mountinfo)
    .filter((mount) => mount.type === 'fuse.sshfs' && mount.path.startsWith(root))
    .map((mount) => mount.path);
}

/** Mount points, their types and devices; mountinfo escapes space, tab, newline and `\` in paths as octal. */
function parseMountinfo(mountinfo: string): Array<Readonly<{ path: string; type: string; device: string }>> {
  const mounts: Array<Readonly<{ path: string; type: string; device: string }>> = [];
  for (const line of mountinfo.split('\n')) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-', 6);
    if (fields.length < 5 || separator < 0) continue;
    mounts.push({
      path: fields[4]!.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))),
      type: fields[separator + 1] ?? '',
      device: fields[2]!,
    });
  }
  return mounts;
}

const osServeSystem: SharedFoldersServeSystem = {
  readMountinfo: () => readFileSync('/proc/self/mountinfo', 'utf8'),
  answers: async (path) => await new Promise<boolean>((resolve) => {
    const probe = spawn('stat', ['-t', path], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      probe.kill('SIGKILL');
      probe.unref();
      resolve(false);
    }, MOUNT_ANSWER_TIMEOUT_MS);
    probe.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    probe.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  }),
  // fusectl names a connection by its device, which for FUSE (major 0) is the minor number.
  abortConnection: (device) => {
    const minor = /^0:(\d+)$/.exec(device)?.[1];
    if (!minor) return `unexpected device ${device}`;
    try {
      writeFileSync(`/sys/fs/fuse/connections/${minor}/abort`, '1');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  unmount: (path) => {
    const result = spawnSync('fusermount3', ['-uz', path], { stdio: 'ignore' });
    if (result.status !== 0) spawnSync('fusermount', ['-uz', path], { stdio: 'ignore' });
  },
  runSshfs: async (args) => await new Promise<number>((resolve) => {
    const child = spawn('sshfs', [...args], { stdio: 'inherit' });
    child.once('error', (error) => {
      process.stderr.write(`piggercode shared folders: cannot run sshfs: ${error.message}\n`);
      resolve(127);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  }),
  reportError: (message) => {
    process.stderr.write(`${message}\n`);
  },
};
