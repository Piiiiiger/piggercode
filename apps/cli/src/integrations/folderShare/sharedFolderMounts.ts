import { readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

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
