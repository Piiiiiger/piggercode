import { lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { isPlaceAgreed } from './acceptedComputers';
import { MOUNT_DEAD_AFTER_MS } from './mountWatchdog';
import { persistentMountDir, persistentMountDirProblem, retireMountsAbove, servePersistentMount } from './persistentMount';
import { parseServerLocation } from './serverLocation';
import { removeEmptyFolders, serverPlaceProblem } from './serverPlace';
import { osServeSystem, type SharedFoldersServeSystem } from './serveSystem';
import {
  COMPUTER_LABEL_PATTERN,
  SHARED_FOLDER_SOURCE_PREFIX,
  isWithin,
  listSharedFolderMounts,
  type SharedFolderMount,
} from './sharedFolderMounts';

export type { SharedFoldersServeSystem } from './serveSystem';

/**
 * `piggercode machine shared-folders serve --label <label> [--place <place>…]`, the forced command of a
 * computer's key on this server (see `acceptedComputers.ts`). The computer runs
 * `ssh <server> "mount <folder><TAB><place>"` with its sandboxed sftp-server on the other end of the
 * connection; this mounts that folder at `~/<place>`, a place this server agreed to for that computer.
 * A placed folder keeps one mount across its connections (`persistentMount.ts`), so programs working in it
 * keep their folder when a connection drops; a computer from before places asks `mount <folder>` and gets
 * `~/local/<label>/<folder>`, mounted with sshfs in passive mode over the same connection for as long as
 * that connection lasts (as is a placed folder in a home sshfs cannot name). Nothing may be written
 * to stdout: stdout is the connection. Errors go to stderr, which the computer shows as the reason a
 * share is not connected.
 */

const SSHFS_OPTIONS = 'passive,idmap=user,dir_cache=yes,dcache_timeout=10';

export async function runSharedFoldersServe(params: Readonly<{
  label: string;
  originalCommand: string | undefined;
  homeDir: string;
  /** This server's PiggerCode home, where persistent mounts keep their state (`persistentMount.ts`). */
  happyHomeDir: string;
  /** The connection: the computer's sftp-server is on its other end. */
  input: Readable;
  output: Writable;
  /** The shell command a persistent mount's sshfs runs to join a connection (`attach --dir <dir>`). */
  attachCommand: (dir: string) => string;
  system?: SharedFoldersServeSystem;
}>): Promise<number> {
  const system = params.system ?? osServeSystem;
  if (!COMPUTER_LABEL_PATTERN.test(params.label)) {
    system.reportError('piggercode shared folders: invalid label');
    return 2;
  }
  const request = parseMountRequest(params.originalCommand);
  if (!request) {
    system.reportError('piggercode shared folders: this key can only mount a folder inside your home');
    return 2;
  }
  const { folder } = request;
  // Where the user chose (`~/code` by default), or `~/local/<label>/<folder>` for a computer from before
  // places, which asks for the folder alone.
  let at: string | undefined;
  if (request.at !== undefined) {
    const location = parseServerLocation(request.at);
    if (!location.ok) {
      system.reportError(`piggercode shared folders: ${location.error}`);
      return 2;
    }
    at = location.at;
    if (!isPlaceAgreed(params.homeDir, params.label, at)) {
      system.reportError(`piggercode shared folders: ~/${at} is not a place this server agreed to for this computer; share the folder there again from the app`);
      return 2;
    }
  }
  const place = at ?? `local/${params.label}/${folder}`;
  const mountPoint = join(params.homeDir, place);
  const shown = `~/${place}`;

  // The shared folders mounted here on the way to the place: the place itself, or one it lies in.
  // Another computer's is never touched. This computer's is a share it moved or dropped: nothing
  // touches the path while that sits on it, since through a dead connection's mount mkdir fails and a
  // stat waits until that connection is ended. Only mountinfo is read first.
  const mounts = listSharedFolderMounts(params.homeDir, system.readMountinfo());
  const othersOnTheWay = mounts.find((mount) => mount.label !== params.label && isWithin(mountPoint, mount.path));
  if (othersOnTheWay) {
    system.reportError(`piggercode shared folders: ${shown} on the server is in a folder another computer shares, so nothing is mounted there`);
    return 3;
  }
  const persistentDir = at === undefined ? null : persistentMountDir(params.happyHomeDir, mountPoint);
  const persistent = persistentDir !== null && persistentMountDirProblem(persistentDir) === null;
  if (persistent && at !== undefined) {
    // The mount at the place is its owner's to keep or replace; one of this computer's above it (a share
    // moved inward) is ended first, under its own lock, unless it answers.
    const refusal = await retireMountsAbove({ label: params.label, homeDir: params.homeDir, happyHomeDir: params.happyHomeDir, mountPoint, system });
    if (refusal !== null) {
      system.reportError(`piggercode shared folders: ${refusal}`);
      return 3;
    }
    removeEmptyLegacyFolders(params.homeDir, params.label, folder, mounts);
    return await servePersistentMount({
      label: params.label,
      folder,
      at,
      homeDir: params.homeDir,
      happyHomeDir: params.happyHomeDir,
      input: params.input,
      output: params.output,
      attachCommand: params.attachCommand,
      system,
    });
  }
  const notCleared = await endDeadMountsOnTheWay({ system, label: params.label, mounts, mountPoint });
  if (notCleared !== null) return notCleared;
  // The place as it is on disk, now that no mount of this computer hangs on the way.
  const problem = serverPlaceProblem(params.homeDir, place);
  if (problem) {
    system.reportError(`piggercode shared folders: ${problem} on the server, so nothing is mounted there`);
    return 3;
  }
  if (at !== undefined) removeEmptyLegacyFolders(params.homeDir, params.label, folder, mounts);
  let made: string | undefined;
  try {
    try {
      made = mkdirSync(mountPoint, { recursive: true });
      if (readdirSync(mountPoint).length > 0) {
        system.reportError(`piggercode shared folders: ${shown} on the server is not empty, so nothing is mounted over it`);
        return 3;
      }
    } catch (error) {
      system.reportError(`piggercode shared folders: cannot use ${shown} on the server: ${error instanceof Error ? error.message : String(error)}`);
      return 3;
    }
    // Asked again: the app may have moved or stopped the share while a dropped connection was ended.
    if (at !== undefined && !isPlaceAgreed(params.homeDir, params.label, at)) {
      system.reportError(`piggercode shared folders: ${shown} is no longer a place this server agreed to for this computer`);
      return 2;
    }
    // The mount names whose it is (`piggercode:<label>:<folder>`), so this server can tell its shared
    // folders, and whose they are, wherever they are mounted.
    const options = `${SSHFS_OPTIONS},fsname=${SHARED_FOLDER_SOURCE_PREFIX}${params.label}:${encodeURIComponent(folder)}`;
    // A mount that stops answering (the computer sleeps, the connection stalls) would hang whatever touches
    // it until this connection is ended, which may take hours: end it then. The aborted mount answers at
    // once with an error until the computer connects again, and that new connection replaces it.
    // Only this connection's own mount is ended: its device, noted from the mount table as soon as the mount
    // shows there (no earlier mount of this computer is left at the place by now), and only while it is still
    // the mount at the place. A newer connection of the computer may have replaced it there by then.
    const ended = new AbortController();
    const mountHere = () => listSharedFolderMounts(params.homeDir, system.readMountinfo())
      .find((candidate) => candidate.path === mountPoint && candidate.label === params.label);
    let ownDevice: string | null = null;
    const noteOwnDevice = () => {
      if (ownDevice === null) ownDevice = mountHere()?.device ?? null;
      if (ownDevice !== null) clearInterval(deviceLookup);
    };
    const deviceLookup = setInterval(noteOwnDevice, 500);
    deviceLookup.unref?.();
    // sshfs carries every byte of the connection: what it has written grows while the computer answers, also
    // while one request waits behind a big copy for minutes.
    let sshfsPid: number | null = null;
    const watch = system.watchMount?.(mountPoint, {
      onAnswer: noteOwnDevice,
      progress: () => (sshfsPid === null ? null : system.bytesWrittenBy?.(sshfsPid) ?? null),
      onDead: () => {
        system.reportError(`piggercode shared folders: ${shown} did not answer for ${Math.round(MOUNT_DEAD_AFTER_MS / 1000)} s and no data moved, so this connection is ended; the computer connects again once it can`);
        const notEnded = ownDevice !== null && mountHere()?.device === ownDevice ? system.abortConnection(ownDevice) : null;
        if (notEnded !== null) system.reportError(`piggercode shared folders: cannot end the mount at ${shown}: ${notEnded}`);
        ended.abort();
      },
    });
    try {
      return await system.runSshfs(['-f', '-o', options, `:${folder}`, mountPoint], ended.signal, (pid) => {
        sshfsPid = pid;
      });
    } finally {
      clearInterval(deviceLookup);
      watch?.stop();
    }
  } finally {
    // A share that moved or stopped leaves its place: the folder there goes once empty, with the folders
    // made for it. A connection that only dropped keeps it for the next one (which may be mounting there
    // already).
    if (at !== undefined && !isPlaceAgreed(params.homeDir, params.label, at) && !mountedOnTheWay(params.homeDir, mountPoint, system)) {
      removeEmptyFolders(mountPoint, made ?? mountPoint);
    }
  }
}

/**
 * This computer's mounts on the way to `mountPoint`: the place itself, or one it lies in. Another computer's
 * is never touched. This computer's is a share it moved or dropped: nothing touches the path while that sits
 * on it, since through a dead connection's mount mkdir fails and a stat waits until that connection is ended.
 * The outermost is kept while it answers (the place is then refused), and otherwise ended with every mount
 * under it. Null when the way is clear, otherwise the exit code.
 */
async function endDeadMountsOnTheWay(params: Readonly<{
  system: SharedFoldersServeSystem;
  label: string;
  mounts: readonly SharedFolderMount[];
  mountPoint: string;
}>): Promise<number | null> {
  const { system, mounts } = params;
  const computerMounts = mounts.filter((mount) => mount.label === params.label);
  const outermost = computerMounts
    .filter((mount) => isWithin(params.mountPoint, mount.path))
    .sort((left, right) => left.path.length - right.path.length)[0];
  if (!outermost) return null;
  // Unmounting it detaches everything mounted below it, which must all be this computer's.
  if (mounts.some((mount) => mount.label !== params.label && isWithin(mount.path, outermost.path))) {
    system.reportError(`piggercode shared folders: ${outermost.path} holds a folder another computer shares, so it is left alone`);
    return 3;
  }
  if ((await system.probe(outermost.path)) === 'answers') {
    system.reportError(`piggercode shared folders: ${outermost.path} is already mounted on the server`);
    return 3;
  }
  // The connection behind it is gone (a network change, a computer asleep) and the mount hangs. End the
  // connections of it and of every mount under it (the unmount detaches them all) before unmounting:
  // each sshfs, when its transport finally closes, unmounts by path, and would take the new mount with
  // it while anything still held the old one (an agent working in the folder). An aborted connection
  // leaves the path alone (libfuse's fuse_kern_unmount); only an sshfs already exiting before the abort
  // can still unmount it, which ends the new connection, and the computer connects again.
  for (const mount of computerMounts.filter((candidate) => isWithin(candidate.path, outermost.path))) {
    const notEnded = system.abortConnection(mount.device);
    // A connection already gone (its sshfs died) needs no ending.
    if (notEnded !== null && system.connectionExists(mount.device) !== false) {
      system.reportError(`piggercode shared folders: cannot end the dropped connection's mount at ${mount.path}: ${notEnded}`);
      return 3;
    }
  }
  system.unmount(outermost.path);
  return null;
}

/**
 * Whether a shared folder is mounted at `path` or a folder it lies in now (another computer's, since):
 * the folders there are then that computer's, never to be removed through its mount. Also when the
 * mount table cannot be read.
 */
function mountedOnTheWay(homeDir: string, path: string, system: SharedFoldersServeSystem): boolean {
  try {
    return listSharedFolderMounts(homeDir, system.readMountinfo()).some((mount) => isWithin(path, mount.path));
  } catch {
    return true;
  }
}

/**
 * A computer that moved to places leaves its `~/local/<label>/<folder>` behind: those folders go once
 * empty, and `~/local` with them. Only plain folders, never through a symbolic link, and nothing while
 * a shared folder is mounted on the way.
 */
function removeEmptyLegacyFolders(homeDir: string, label: string, folder: string, mounts: readonly SharedFolderMount[]): void {
  const local = join(homeDir, 'local');
  const deepest = join(local, label, folder);
  if (mounts.some((mount) => isWithin(mount.path, local) || isWithin(local, mount.path))) return;
  const chain: string[] = [];
  for (let path = deepest; isWithin(path, local); path = dirname(path)) {
    chain.unshift(path);
    if (path === local) break;
  }
  // Every part, from ~/local down, must be a plain folder: a link would lead rmdir elsewhere.
  for (const path of chain) {
    try {
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return;
    } catch {
      return;
    }
  }
  removeEmptyFolders(deepest, local);
}

/**
 * `mount <folder>` or `mount <folder><TAB><location>`, the folder relative to the computer's home and
 * the location relative to this server's home (`serverLocation.ts` checks it); null for anything else.
 */
function parseMountRequest(originalCommand: string | undefined): Readonly<{ folder: string; at?: string }> | null {
  if (!originalCommand?.startsWith('mount ')) return null;
  const [rawFolder, at, ...rest] = originalCommand.slice('mount '.length).split('\t');
  if (rest.length > 0 || rawFolder === undefined) return null;
  const folder = rawFolder.replace(/\/+$/, '');
  if (!folder || folder.startsWith('/') || folder.startsWith('-') || /[\x00-\x1f\x7f]/.test(folder)) return null;
  const segments = folder.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return at === undefined ? { folder } : { folder, at };
}
