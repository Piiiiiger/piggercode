import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The shared folders mounted on this server, from its mount table. Every reader of them goes through
 * here: `serve`, the agreement, the file-browser roots, the agents' prompt, the daemon's own guard
 * on deleting and renaming, and whether a path in one can be used now (`sharedFolderHealth.ts`).
 */

/** A shared folder mounted on this server now: where in the home, and whose (the computer's label and its folder). */
export type SharedFolderMount = Readonly<{ path: string; label: string; folder: string; device: string }>;

/** How a shared folder's mount names itself in mountinfo: `piggercode:<label>:<folder, URI-encoded>`. */
export const SHARED_FOLDER_SOURCE_PREFIX = 'piggercode:';

/** A computer's label on this server, as its key's forced command carries it. */
export const COMPUTER_LABEL_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The shared folders mounted on this server now: an sshfs mount that names itself
 * `piggercode:<label>:<folder>` anywhere in the home, or one in `~/local/<label>/` (a computer from
 * before places). The mount table names real paths; a home reached through a symbolic link
 * (/home/u → /srv/homes/u) has its mounts given back under the home as named. None where there is no
 * mount table to read (not Linux), since this server mounts nothing there.
 */
export function listSharedFolderMounts(homeDir: string, mountinfo: string = readMountinfoIfAny()): SharedFolderMount[] {
  const realHome = realHomeOf(homeDir);
  const local = join(homeDir, 'local');
  return parseMountinfo(mountinfo).flatMap((mount) => {
    if (mount.type !== 'fuse.sshfs') return [];
    const path = isWithin(mount.path, homeDir)
      ? mount.path
      : realHome !== homeDir && isWithin(mount.path, realHome) ? join(homeDir, relative(realHome, mount.path)) : null;
    if (path === null) return [];
    if (mount.source.startsWith(SHARED_FOLDER_SOURCE_PREFIX)) {
      const [label, encodedFolder] = mount.source.slice(SHARED_FOLDER_SOURCE_PREFIX.length).split(':');
      if (!label || !COMPUTER_LABEL_PATTERN.test(label) || !encodedFolder) return [];
      try {
        return [{ path, label, folder: decodeURIComponent(encodedFolder), device: mount.device }];
      } catch {
        return [];
      }
    }
    if (!path.startsWith(`${local}/`)) return [];
    const [label, ...folder] = path.slice(local.length + 1).split('/');
    if (!label || folder.length === 0) return [];
    return [{ path, label, folder: folder.join('/'), device: mount.device }];
  });
}

/** The home's real path, which the mount table names; the home as named when it cannot be resolved. */
export function realHomeOf(homeDir: string): string {
  try {
    return realpathSync(homeDir);
  } catch {
    return homeDir;
  }
}

export function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/** This process's mount table (Linux); throws where there is none. */
export function readMountinfo(): string {
  return readFileSync('/proc/self/mountinfo', 'utf8');
}

/** The mount table, or nothing where there is none to read. */
export function readMountinfoIfAny(): string {
  try {
    return readMountinfo();
  } catch {
    return '';
  }
}

function unescapeMountinfo(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

type MountinfoEntry = Readonly<{ path: string; type: string; source: string; device: string }>;

/** Mount points, their types, sources and devices; mountinfo escapes space, tab, newline and `\` as octal. */
function parseMountinfo(mountinfo: string): MountinfoEntry[] {
  const mounts: MountinfoEntry[] = [];
  for (const line of mountinfo.split('\n')) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-', 6);
    if (fields.length < 5 || separator < 0) continue;
    mounts.push({
      path: unescapeMountinfo(fields[4]!),
      type: fields[separator + 1] ?? '',
      source: unescapeMountinfo(fields[separator + 2] ?? ''),
      device: fields[2]!,
    });
  }
  return mounts;
}

/** A shared folder that does not answer a `stat` within this long is the dead end of a dropped connection. */
export const MOUNT_ANSWER_TIMEOUT_MS = 5_000;

/**
 * What a mount said to one request that only the computer can answer:
 * - `answers`: the computer answered (a name that is not there, or any other reply);
 * - `disconnected`: sshfs is there but has no connection to the computer (EIO, a persistent mount while
 *   the computer is away);
 * - `dead`: nothing serves the mount any more (ENOTCONN: its sshfs is gone or its connection was ended);
 * - `silent`: no answer within MOUNT_ANSWER_TIMEOUT_MS (a stalled connection, or a wedged sshfs).
 */
export type MountProbeResult = 'answers' | 'disconnected' | 'dead' | 'silent';

export type MountProbe = Readonly<{ result: Promise<MountProbeResult>; answers: Promise<boolean>; exited: Promise<void> }>;

/**
 * A name in the mount that nothing creates: asking for it can only be answered by the computer. The mount
 * itself and what was listed in it lately are answered from caches (sshfs's own and the kernel's) even while
 * the connection behind them is stalled, so they show nothing.
 */
export function mountProbePath(path: string): string {
  return join(path, `.piggercode-probe-${randomBytes(6).toString('hex')}`);
}

/**
 * How `stat` (in the C locale) reports what the mount said: `stat: cannot statx '<path>': <error>`. Only the
 * error after the probe's name counts (a folder may be named like an error); anything else is still an answer.
 */
export function readMountProbeResult(exitCode: number | null, stderr: string): MountProbeResult {
  if (exitCode === 0) return 'answers';
  // Killed by a signal: it said nothing.
  if (exitCode === null) return 'silent';
  const lastLine = stderr.trim().split('\n').at(-1) ?? '';
  // Anchored on the probe's own name, whatever quoting `stat` chose for the path ('…', "…" or none).
  const error = /\.piggercode-probe-[0-9a-f]+['"]?: (.*)$/.exec(lastLine)?.[1] ?? '';
  if (error === 'Transport endpoint is not connected') return 'dead';
  if (error === 'Input/output error') return 'disconnected';
  return 'answers';
}

/**
 * Asks the mount at `path` a question only the computer can answer (`mountProbePath`), from a separate
 * `stat` started outside the mount, so this process never waits on it. The result comes within
 * MOUNT_ANSWER_TIMEOUT_MS: `silent` when the probe has not finished by then. A probe a dead connection holds
 * cannot be killed before that connection is ended; it is left behind, and `exited` settles once it is gone.
 */
export function startMountProbe(path: string): MountProbe {
  const probe = spawn('stat', ['-t', mountProbePath(path)], {
    cwd: '/',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  let stderr = '';
  probe.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < 4096) stderr += chunk.toString('utf8');
  });
  const exited = new Promise<void>((resolve) => {
    probe.once('exit', () => resolve());
    probe.once('error', () => resolve());
  });
  const result = new Promise<MountProbeResult>((resolve) => {
    const timer = setTimeout(() => {
      probe.kill('SIGKILL');
      probe.unref();
      probe.stderr?.destroy();
      resolve('silent');
    }, MOUNT_ANSWER_TIMEOUT_MS);
    probe.once('error', () => {
      clearTimeout(timer);
      resolve('silent');
    });
    probe.once('close', (code) => {
      clearTimeout(timer);
      resolve(readMountProbeResult(code, stderr));
    });
  });
  return { result, answers: result.then((value) => value === 'answers'), exited };
}

/** What the mount at `path` said to one probe (`startMountProbe`). */
export async function probeMount(path: string): Promise<MountProbeResult> {
  return await startMountProbe(path).result;
}
