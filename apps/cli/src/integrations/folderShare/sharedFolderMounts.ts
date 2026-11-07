import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

/**
 * The shared folders mounted on this server, from its mount table. Every reader of them goes through
 * here: `serve`, the agreement, the file-browser roots, the agents' prompt and the daemon's own guard
 * on deleting and renaming.
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

export type MountProbe = Readonly<{ answers: Promise<boolean>; exited: Promise<void> }>;

/**
 * Asks whether the mount at `path` answers, from a separate `stat` started outside the mount, so this
 * process never waits on it. The answer comes within MOUNT_ANSWER_TIMEOUT_MS: false when the probe has not
 * finished by then. A probe a dead connection holds cannot be killed before that connection is aborted; it
 * is left behind, and `exited` settles once it is gone.
 */
export function startMountProbe(path: string): MountProbe {
  const probe = spawn('stat', ['-t', path], { cwd: '/', stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => {
    probe.once('exit', () => resolve());
    probe.once('error', () => resolve());
  });
  const answers = new Promise<boolean>((resolve) => {
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
  });
  return { answers, exited };
}

/** Whether the mount at `path` answers (`startMountProbe`). */
export async function mountAnswers(path: string): Promise<boolean> {
  return await startMountProbe(path).answers;
}

/** How long one answer of a shared folder stands before the folder is asked again. */
const SHARED_FOLDER_ANSWER_FRESH_MS = 10_000;

export type SharedFolderPathCheck = Readonly<{ inSharedFolder: boolean; problem: string | null }>;

/**
 * Checks a path before this process starts anything there or touches it. A folder another computer shares
 * here answers only while that computer's connection is up; anything started in it while the connection
 * hangs (a process's working directory, a stat, a realpath) waits until the connection is ended, and in a
 * daemon that holds every other request too. So a path in a shared folder is used only while the folder
 * answers. A path elsewhere costs one read of the mount table. One probe at a time per folder: an answer
 * stands for 10 s, and while a probe is held by a dead connection no other is started.
 */
export function createSharedFolderHealth(deps: Readonly<{
  homeDir?: () => string;
  readMountinfo?: () => string;
  probe?: (path: string) => MountProbe;
  now?: () => number;
}> = {}) {
  const homeDirOf = deps.homeDir ?? homedir;
  const readTable = deps.readMountinfo ?? readMountinfoIfAny;
  const probe = deps.probe ?? startMountProbe;
  const now = deps.now ?? Date.now;
  const asked = new Map<string, { at: number; answers: Promise<boolean>; probeRunning: boolean }>();
  return {
    /**
     * Whether `path` lies in a shared folder: one read of the mount table, nothing touches the folder. The
     * path is taken as written (`..` and `.` resolved, no links followed: that would touch the folder).
     */
    covers(path: string): boolean {
      const normalized = resolve(path);
      return listSharedFolderMounts(homeDirOf(), readTable()).some((mount) => isWithin(normalized, mount.path));
    },
    async check(path: string): Promise<SharedFolderPathCheck> {
      const homeDir = homeDirOf();
      const normalized = resolve(path);
      const mount = listSharedFolderMounts(homeDir, readTable())
        .filter((candidate) => isWithin(normalized, candidate.path))
        .sort((left, right) => right.path.length - left.path.length)[0];
      if (!mount) return { inSharedFolder: false, problem: null };
      const key = `${mount.device} ${mount.path}`;
      let entry = asked.get(key);
      if (!entry || (!entry.probeRunning && now() - entry.at > SHARED_FOLDER_ANSWER_FRESH_MS)) {
        const started = probe(mount.path);
        const fresh = { at: now(), answers: started.answers, probeRunning: true };
        void started.exited.then(() => {
          fresh.probeRunning = false;
        });
        asked.set(key, fresh);
        entry = fresh;
      }
      if (await entry.answers) return { inSharedFolder: true, problem: null };
      const shown = isWithin(mount.path, homeDir) ? `~/${relative(homeDir, mount.path)}` : mount.path;
      return {
        inSharedFolder: true,
        problem: `${shown} is a folder the computer ${mount.label} shares here, and that computer is not answering now (asleep or offline). Try again once it is back.`,
      };
    },
  };
}

const sharedFolderHealth = createSharedFolderHealth();

/**
 * `createSharedFolderHealth()` for this process. Callers ask `isInSharedFolder` first and await
 * `checkSharedFolderPath` only for a path in a shared folder, so everything else starts as before.
 */
export const isInSharedFolder = (path: string): boolean => sharedFolderHealth.covers(path);
export const checkSharedFolderPath = (path: string): Promise<SharedFolderPathCheck> => sharedFolderHealth.check(path);
