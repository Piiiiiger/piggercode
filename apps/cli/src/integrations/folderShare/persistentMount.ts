import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { basename, join, relative } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { withJsonOwnerFileLock } from '@/utils/fs/jsonOwnerFileLock';

import { isPlaceAgreed, isPlaceWithdrawn, readPlaceAgreement } from './acceptedComputers';
import { MOUNT_DEAD_AFTER_MS, type MountWatch } from './mountWatchdog';
import { removeEmptyFolders, serverPlaceProblem } from './serverPlace';
import { sameProcess, type ProcessIdentity, type SharedFoldersServeSystem } from './serveSystem';
import { isWithin, listSharedFolderMounts, SHARED_FOLDER_SOURCE_PREFIX, type SharedFolderMount } from './sharedFolderMounts';

/**
 * A placed shared folder's mount that outlives its connections. When a connection drops, the mount stays:
 * programs working in the folder keep their working directory and paths, files fail with EIO while the
 * computer is away, and work again once it connects. Remounting instead (a passive sshfs per connection,
 * `serve.ts`) leaves every such program in a folder that no longer exists (2026-11-28: Codex's
 * `/permissions` broke on it after a reconnect; the share reconnected 20 times in 28 hours).
 *
 * One sshfs per mount path runs with `-o reconnect` on its own, started by the first connection. sshfs
 * reconnects on its next request by running its `ssh_command`, a small script (`attach.sh`) that joins the
 * connection of the computer's that is waiting on this mount's socket (`attach`), or fails at once when none
 * is, which sshfs turns into EIO. Each `serve` (one per connection of the computer, its key's forced command)
 * offers its connection on that socket. State lives in `<PiggerCode home>/shared-folders/mounts/<hash of the
 * path>/`, and every change to a mount path happens under that directory's lock.
 */

const PERSISTENT_SSHFS_OPTIONS = 'reconnect,idmap=user,dir_cache=yes,dcache_timeout=10';

/**
 * How long the first connection may take until sshfs has mounted through it. It holds the mount's lock
 * meanwhile, and stopping or moving a share waits for that lock (`clearWithdrawnPersistentMounts`), so it is
 * bounded; sshfs mounts within moments once the computer answers.
 */
export const BOOTSTRAP_TIMEOUT_MS = 10_000;
/** How long an offered connection waits for sshfs to come for it once poked (`attach` starts in about 1.2 s). */
export const ATTACH_WAIT_MS = 10_000;
/** How long a connection that took over waits for the one it ended to exit before killing it. */
export const INCUMBENT_EXIT_WAIT_MS = 2_000;
/**
 * How long `serve` waits for the mount's lock: longer than the longest a holder keeps it (a probe, ending the
 * old connection, a second probe and a first mount: 5 + 2 + 5 + 10 s).
 */
export const SERVE_LOCK_WAIT_MS = 30_000;
/** How long the daemon waits for a mount's lock before leaving it for its next pass. */
export const WITHDRAW_LOCK_WAIT_MS = 2_000;
/** How often the daemon looks again at withdrawn places whose mount was busy. */
export const WITHDRAW_RETRY_MS = 5_000;
/** How often the carrying `serve` marks, for a newcomer, that data came from the computer. */
const RX_MARK_INTERVAL_MS = 1_000;

const STATE = 'state.json';
const OWNER = 'owner.json';
const RX = 'rx';
const LOG = 'sshfs.log';
const LOCK = 'lock';
const SOCK = 'sock';
const TRAMPOLINE = 'attach.sh';

type MountState = Readonly<{
  v: 1;
  label: string;
  folder: string;
  at: string;
  mountPoint: string;
  /** Null in the record a first connection writes before it starts sshfs (so a withdrawal can find it). */
  sshfs: ProcessIdentity | null;
  /** The mount's device once it is mounted; null while the first connection is still mounting it. */
  device: string | null;
  /** The outermost folder made for the mount (removed with it, once empty, when its place is withdrawn). */
  made: string | null;
}>;

type OwnerState = Readonly<{ v: 1; serve: ProcessIdentity }>;

export function persistentMountsDir(happyHomeDir: string): string {
  return join(happyHomeDir, 'shared-folders', 'mounts');
}

export function persistentMountDir(happyHomeDir: string, mountPoint: string): string {
  return join(persistentMountsDir(happyHomeDir), createHash('sha256').update(mountPoint).digest('hex').slice(0, 16));
}

/**
 * Why a mount cannot be kept in `dir`, or null. sshfs splits its `ssh_command` at spaces (and keeps the
 * backslash of an escaped one), and libfuse reads commas and backslashes in the `-o` list as its own; such a
 * home keeps the remounting sshfs (`serve.ts`).
 */
export function persistentMountDirProblem(dir: string): string | null {
  return /[\s,\\]/.test(dir) ? `${dir} holds a space, comma or backslash` : null;
}

/** `text` as one word for /bin/sh. */
function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The arguments of a mount path's sshfs. */
export function persistentSshfsArgs(params: Readonly<{ dir: string; label: string; folder: string; mountPoint: string }>): string[] {
  const options = [
    PERSISTENT_SSHFS_OPTIONS,
    `ssh_command=/bin/sh ${join(params.dir, TRAMPOLINE)}`,
    `fsname=${SHARED_FOLDER_SOURCE_PREFIX}${params.label}:${encodeURIComponent(params.folder)}`,
  ].join(',');
  return ['-f', '-o', options, `x:${params.folder}`, params.mountPoint];
}

function isIdentity(value: unknown): value is ProcessIdentity {
  const record = value as Partial<ProcessIdentity> | null;
  return typeof record === 'object' && record !== null
    && typeof record.bootId === 'string' && typeof record.pid === 'number' && typeof record.startTicks === 'string';
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function readState(dir: string): MountState | null {
  const value = readJson(join(dir, STATE)) as Partial<MountState> | null;
  if (!value || value.v !== 1 || (value.sshfs !== null && !isIdentity(value.sshfs))) return null;
  if (typeof value.label !== 'string' || typeof value.folder !== 'string' || typeof value.at !== 'string') return null;
  if (typeof value.mountPoint !== 'string' || (value.device !== null && typeof value.device !== 'string')) return null;
  return { ...value, made: typeof value.made === 'string' ? value.made : null } as MountState;
}

function readOwner(dir: string): OwnerState | null {
  const value = readJson(join(dir, OWNER)) as Partial<OwnerState> | null;
  return value && value.v === 1 && isIdentity(value.serve) ? (value as OwnerState) : null;
}

function writeAtomic(path: string, text: string, mode = 0o600): void {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, text, { mode });
  renameSync(temporary, path);
}

function writeState(dir: string, state: MountState): void {
  writeAtomic(join(dir, STATE), `${JSON.stringify(state)}\n`);
}

function writeOwner(dir: string, serve: ProcessIdentity): void {
  writeAtomic(join(dir, OWNER), `${JSON.stringify({ v: 1, serve } satisfies OwnerState)}\n`);
}

function removeFile(path: string): void {
  rmSync(path, { force: true });
}

/** When data last came from the computer through this mount's carrying `serve` (0 when never). */
function rxMark(dir: string): number {
  try {
    return statSync(join(dir, RX)).mtimeMs;
  } catch {
    return 0;
  }
}

/** The script sshfs runs to reach the computer: it joins a waiting connection, or fails at once. */
function writeTrampoline(dir: string, attachCommand: string): void {
  writeAtomic(join(dir, TRAMPOLINE), [
    '#!/bin/sh',
    '# PiggerCode shared folder: what sshfs runs to reach the computer (its ssh_command). It joins the',
    "# computer's connection waiting here, and fails at once while none is, which sshfs turns into EIO.",
    `[ -S ${shellQuote(join(dir, SOCK))} ] || exit 1`,
    // `exec`, so sshfs's child is `attach` itself; a command with its environment first goes through `env`.
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(attachCommand) ? `exec env ${attachCommand}` : `exec ${attachCommand}`,
    '',
  ].join('\n'), 0o700);
}

/** This boot, as a short tag (from the kernel's boot id). Without it no lock is taken (see `withMountLock`). */
function bootTag(): string {
  const tag = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim().replace(/-/g, '').slice(0, 12);
  if (!/^[0-9a-f]{12}$/.test(tag)) throw new Error('cannot read this boot\'s id');
  return tag;
}

/** The lock of the mount kept in `dir`, named after this boot. */
export function mountLockPath(dir: string): string {
  return join(dir, `${LOCK}-${bootTag()}`);
}

async function withMountLock<T>(dir: string, waitMs: number, effect: () => Promise<T>): Promise<T> {
  // No holder survives a reboot, but its pid may name another process by now, which the lock would take for
  // the holder for as long as that process lives. So the lock is named after this boot: one from an earlier
  // boot is never asked, and is removed (nothing of this boot uses its name).
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = mountLockPath(dir);
  const lock = basename(lockPath);
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(`${LOCK}-`) && !name.startsWith(lock)) rmSync(join(dir, name), { force: true, recursive: true });
    }
  } catch {
    // Nothing to clear.
  }
  return await withJsonOwnerFileLock({
    lockPath,
    timeoutMs: waitMs,
    // Taken over only from a holder that is gone (`withJsonOwnerFileLock`): a live holder is never stale. This
    // is how long the leftovers of a holder killed while letting go wait before they are cleared.
    staleAfterMs: 60_000,
    errorCode: 'shared_folder_mount_busy',
  }, effect);
}

/** A wait that keeps the process alive: `serve` must finish what it holds the lock for before it exits. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(condition: () => boolean, ms: number, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() >= deadline) return false;
    await sleep(stepMs);
  }
  return true;
}

type Offer = Readonly<{
  /** Listens for sshfs on a socket of its own and points the mount's `sock` at it. */
  publish: () => Promise<void>;
  /** True once sshfs joined; false if the offer closed first. */
  joined: Promise<boolean>;
  /** Settles once the carried connection ended, from either side, or the offer closed. */
  ended: Promise<void>;
  rxBytes: () => number;
  close: () => void;
}>;

/**
 * This connection, offered to sshfs on a socket of its own in the mount's directory (which must be the
 * working directory: the socket is bound by its short name, so a long home is no problem). It carries
 * exactly one sshfs connection; the socket goes as soon as sshfs has joined, so `sock` then names nothing
 * and the next reconnect of sshfs fails at once until another connection is offered.
 */
function createOffer(params: Readonly<{ dir: string; input: Readable; output: Writable }>): Offer {
  const name = `s-${randomBytes(4).toString('hex')}.sock`;
  let server: Server | null = null;
  let socket: Socket | null = null;
  let closed = false;
  let rx = 0;
  let markedAt = 0;
  let resolveJoined: (joined: boolean) => void = () => undefined;
  let resolveEnded: () => void = () => undefined;
  const joined = new Promise<boolean>((resolve) => {
    resolveJoined = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  const rxPath = join(params.dir, RX);
  // The connection's streams fail when either side goes (EPIPE on the ssh channel); that is its end, and it
  // must never surface as an error of `serve`, also after the offer closed.
  const ignore = () => undefined;
  params.input.on('error', ignore);
  params.output.on('error', ignore);

  const onInput = (chunk: Buffer) => {
    rx += chunk.length;
    const now = Date.now();
    if (now - markedAt >= RX_MARK_INTERVAL_MS) {
      markedAt = now;
      try {
        utimesSync(rxPath, now / 1000, now / 1000);
      } catch {
        try {
          closeSync(openSync(rxPath, 'w', 0o600));
        } catch {
          // Only a newcomer's hint; carrying goes on.
        }
      }
    }
    if (socket && !socket.write(chunk)) params.input.pause();
  };
  const onOutputDrain = () => socket?.resume();

  const close = () => {
    if (closed) return;
    closed = true;
    server?.close();
    server = null;
    params.input.off('data', onInput);
    params.input.off('end', close);
    params.input.off('error', close);
    params.output.off('drain', onOutputDrain);
    params.output.off('error', close);
    socket?.destroy();
    resolveJoined(false);
    resolveEnded();
  };

  const onJoin = (incoming: Socket) => {
    if (closed || socket) {
      incoming.destroy();
      return;
    }
    socket = incoming;
    socket.on('error', ignore);
    // One sshfs connection per offer; closing the listener removes its socket file.
    server?.close();
    server = null;
    socket.on('data', (chunk: Buffer) => {
      if (!params.output.write(chunk)) socket?.pause();
    });
    socket.on('drain', () => params.input.resume());
    socket.once('end', close);
    socket.once('close', close);
    socket.once('error', close);
    params.output.on('drain', onOutputDrain);
    params.output.once('error', close);
    params.input.on('data', onInput);
    params.input.once('end', close);
    params.input.once('error', close);
    params.input.resume();
    resolveJoined(true);
    // A side that ended before sshfs came will not say so again.
    if (params.input.readableEnded || params.input.destroyed || params.output.writableEnded || params.output.destroyed) close();
  };

  return {
    publish: async () => await new Promise<void>((resolve, reject) => {
      const listening = createServer(onJoin);
      server = listening;
      listening.once('error', reject);
      listening.listen(name, () => {
        try {
          const link = `${SOCK}.${name}`;
          symlinkSync(name, link);
          renameSync(link, SOCK);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }),
    joined,
    ended,
    rxBytes: () => rx,
    close,
  };
}

type Context = Readonly<{
  label: string;
  folder: string;
  at: string;
  homeDir: string;
  mountPoint: string;
  dir: string;
  shown: string;
  me: ProcessIdentity;
  offer: Offer;
  attachCommand: (dir: string) => string;
  system: SharedFoldersServeSystem;
  report: (message: string) => void;
}>;

type Verdict = 'refuse' | 'admit' | 'replace';

/** The mount of this computer at the exact path, as the mount table lists it now. */
function mountAt(ctx: Pick<Context, 'homeDir' | 'mountPoint' | 'system'>): SharedFolderMount | undefined {
  return listSharedFolderMounts(ctx.homeDir, ctx.system.readMountinfo()).find((mount) => mount.path === ctx.mountPoint);
}

function sshfsAlive(system: SharedFoldersServeSystem, state: MountState): boolean {
  return state.sshfs !== null && sameProcess(system.processIdentity(state.sshfs.pid), state.sshfs);
}

function killSshfs(system: SharedFoldersServeSystem, state: MountState | null): void {
  if (state && state.sshfs && sshfsAlive(system, state)) system.kill(state.sshfs.pid, 'SIGKILL');
}

/**
 * Ends the mount at the exact path for good: its FUSE connection, its path, its sshfs. Programs in it lose
 * their folder, so this is only for a mount that is dead, wedged, of a computer's legacy kind, serving
 * another folder, or at a place withdrawn. Never while another computer's folder is mounted inside it (the
 * unmount would detach that too). Null once the mount is gone, otherwise why it is not; its record stays then.
 */
function retire(
  ctx: Pick<Context, 'dir' | 'system' | 'homeDir'>,
  mount: SharedFolderMount,
): string | null {
  // One reading of the mount table decides what goes with it: refused while another computer's folder is
  // mounted inside it; its own mounts inside have their connections ended first, so no sshfs keeps a
  // detached mount.
  const below = listSharedFolderMounts(ctx.homeDir, ctx.system.readMountinfo())
    .filter((candidate) => candidate.path !== mount.path && isWithin(candidate.path, mount.path));
  const foreign = below.find((candidate) => candidate.label !== mount.label);
  if (foreign) return `${foreign.path}, a folder another computer shares, is mounted inside it`;
  const inside = below.sort((left, right) => right.path.length - left.path.length);
  const state = readState(ctx.dir);
  for (const candidate of [...inside, mount]) {
    const notEnded = ctx.system.abortConnection(candidate.device);
    if (notEnded === null) continue;
    const exists = ctx.system.connectionExists(candidate.device);
    if (exists === false) continue;
    // Not seen (no fusectl): its own sshfs, dead or killed now, means its connection is gone.
    if (exists === null && candidate === mount && state && state.sshfs) {
      killSshfs(ctx.system, state);
      continue;
    }
    return notEnded;
  }
  ctx.system.unmount(mount.path);
  const left = listSharedFolderMounts(ctx.homeDir, ctx.system.readMountinfo())
    .some((candidate) => candidate.path === mount.path && candidate.device === mount.device);
  if (left) return 'it is still mounted after the unmount';
  killSshfs(ctx.system, state);
  removeFile(join(ctx.dir, STATE));
  removeFile(join(ctx.dir, OWNER));
  return null;
}

/** Stage 1 of ending a stalled connection: the `serve` carrying it exits, which ends its side of the socket. */
async function endIncumbent(ctx: Context): Promise<void> {
  const owner = readOwner(ctx.dir);
  if (!owner || sameProcess(owner.serve, ctx.me)) return;
  const alive = () => sameProcess(ctx.system.processIdentity(owner.serve.pid), owner.serve);
  if (!alive()) return;
  ctx.system.kill(owner.serve.pid, 'SIGTERM');
  if (await waitUntil(() => !alive(), INCUMBENT_EXIT_WAIT_MS)) return;
  ctx.system.kill(owner.serve.pid, 'SIGKILL');
  await waitUntil(() => !alive(), INCUMBENT_EXIT_WAIT_MS);
}

/**
 * What to do with this computer's mount at the exact path. Its own persistent mount is asked before this
 * connection is offered, so the probe can only be answered through the connection already there: one that
 * answers, or that data came through meanwhile, keeps the mount and this connection is refused, as a second
 * connection always was. A dead one, or one serving another folder, is replaced; a stalled one is ended,
 * and then replaced only if sshfs itself does not answer either. A mount it has no record of (a remounting
 * sshfs from before, or unknown) is kept while it answers, and replaced once it does not.
 */
async function classify(ctx: Context, mount: SharedFolderMount): Promise<Verdict> {
  const { system } = ctx;
  const state = readState(ctx.dir);
  const ours = state !== null && state.label === ctx.label && state.mountPoint === ctx.mountPoint
    && (state.device === null || state.device === mount.device);
  if (!ours) return (await system.probe(ctx.mountPoint)) === 'answers' ? 'refuse' : 'replace';
  // Dead, or a first connection's record from before it started sshfs: nothing serves it.
  if (!sshfsAlive(system, state) || system.connectionExists(mount.device) === false) return 'replace';
  // A first connection that ended before it noted the device: the live sshfs's mount completes the record.
  if (state.device === null) writeState(ctx.dir, { ...state, device: mount.device });

  const marked = rxMark(ctx.dir);
  let result = await system.probe(ctx.mountPoint);
  // Data from the computer keeps a connection that is slow to answer; once sshfs says it has none (EIO), the
  // last data that came was that connection's end.
  if (result === 'answers' || (result === 'silent' && rxMark(ctx.dir) !== marked)) return 'refuse';
  if (result === 'silent') {
    await endIncumbent(ctx);
    result = await system.probe(ctx.mountPoint);
    if (result === 'answers') return 'refuse';
  }
  if (result !== 'disconnected') return 'replace';
  return state.folder === ctx.folder ? 'admit' : 'replace';
}

/** The record a first connection writes before it starts sshfs, so that a withdrawal finds and waits for it. */
function recordStarting(ctx: Context, made: string | null): MountState {
  const state: MountState = { v: 1, label: ctx.label, folder: ctx.folder, at: ctx.at, mountPoint: ctx.mountPoint, sshfs: null, device: null, made };
  writeState(ctx.dir, state);
  return state;
}

/**
 * The first connection: offer it, start sshfs, and wait until sshfs has mounted through it. `made` is the
 * outermost folder an earlier mount at the place made (a replaced one), which a withdrawal removes too.
 */
async function bootstrap(ctx: Context, previouslyMade: string | null): Promise<number | 'carry'> {
  const { system } = ctx;
  const problem = serverPlaceProblem(ctx.homeDir, ctx.at);
  if (problem) {
    ctx.report(`${problem} on the server, so nothing is mounted there`);
    return 3;
  }
  let made: string | null = previouslyMade;
  try {
    made = mkdirSync(ctx.mountPoint, { recursive: true }) ?? previouslyMade;
    if (readdirSync(ctx.mountPoint).length > 0) {
      ctx.report(`${ctx.shown} on the server is not empty, so nothing is mounted over it`);
      return 3;
    }
  } catch (error) {
    ctx.report(`cannot use ${ctx.shown} on the server: ${error instanceof Error ? error.message : String(error)}`);
    return 3;
  }
  // The record first, then the agreement asked again: a withdrawal before this point is seen here, one after
  // it finds the record (and waits for this lock).
  recordStarting(ctx, made);
  if (!isPlaceAgreed(ctx.homeDir, ctx.label, ctx.at)) {
    ctx.report(`${ctx.shown} is no longer a place this server agreed to for this computer`);
    removeFile(join(ctx.dir, STATE));
    if (made !== null) removeEmptyFolders(ctx.mountPoint, made);
    return 2;
  }
  writeTrampoline(ctx.dir, ctx.attachCommand(ctx.dir));
  await ctx.offer.publish();
  writeOwner(ctx.dir, ctx.me);
  const started = system.startSshfs(persistentSshfsArgs(ctx), join(ctx.dir, LOG));
  const sshfs = started.pid === null ? null : system.processIdentity(started.pid);
  const record = (identity: ProcessIdentity, device: string | null): MountState => ({
    v: 1, label: ctx.label, folder: ctx.folder, at: ctx.at, mountPoint: ctx.mountPoint, sshfs: identity, device, made,
  });
  // Written before it mounts, so a connection that ends meanwhile leaves the live sshfs known as this mount's.
  if (sshfs) writeState(ctx.dir, record(sshfs, null));

  let exited = false;
  void started.exited.then(() => {
    exited = true;
  });
  const mounted = () => {
    const mount = mountAt(ctx);
    return mount && mount.label === ctx.label && mount.folder === ctx.folder ? mount : undefined;
  };
  await waitUntil(() => exited || mounted() !== undefined || sshfs === null, BOOTSTRAP_TIMEOUT_MS, 100);
  const mount = sshfs === null ? undefined : mounted();
  if (sshfs && mount && sameProcess(system.processIdentity(sshfs.pid), sshfs)) {
    writeState(ctx.dir, record(sshfs, mount.device));
    // Asked once more now that it is mounted: a withdrawal accepted meanwhile ends the mount here (one that
    // cannot be read now leaves it to the daemon's clean-up, which retries).
    if (!isPlaceWithdrawn(ctx.homeDir, ctx.label, ctx.at)) return 'carry';
    ctx.offer.close();
    const notEnded = retire(ctx, mount);
    if (notEnded === null) removeFoldersMadeFor(ctx.homeDir, ctx.system, ctx.mountPoint, made);
    ctx.report(`${ctx.shown} is no longer a place this server agreed to for this computer`);
    return 2;
  }
  // It did not mount in time, or ended: undo it all, so the next connection starts clean. A mount it cannot
  // end keeps its record for the next connection and the daemon.
  ctx.offer.close();
  if (sshfs && sameProcess(system.processIdentity(sshfs.pid), sshfs)) system.kill(sshfs.pid, 'SIGKILL');
  const left = mountAt(ctx);
  const notEnded = left && left.label === ctx.label ? retire(ctx, left) : null;
  if (notEnded === null) {
    removeFile(join(ctx.dir, STATE));
    removeFile(join(ctx.dir, OWNER));
    // The folders made for the mount (by this attempt or the one it replaced) go with the record: a stop before
    // the next try would find no record of them. A folder that was there before stays, unless withdrawn.
    if (made !== null || isPlaceWithdrawn(ctx.homeDir, ctx.label, ctx.at)) removeFoldersMadeFor(ctx.homeDir, system, ctx.mountPoint, made);
  }
  ctx.report(`sshfs did not mount ${ctx.shown}${readLogTail(ctx.dir)}${notEnded === null ? '' : `; ${notEnded}`}`);
  return 3;
}

function readLogTail(dir: string): string {
  try {
    const lines = readFileSync(join(dir, LOG), 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.length > 0 ? `: ${lines[lines.length - 1]}` : '';
  } catch {
    return '';
  }
}

/** Decides, under the mount's lock, whether and how this connection serves the mount. */
async function admit(ctx: Context): Promise<number | 'carry' | 'poke'> {
  if (!isPlaceAgreed(ctx.homeDir, ctx.label, ctx.at)) {
    ctx.report(`${ctx.shown} is no longer a place this server agreed to for this computer`);
    return 2;
  }
  const mount = mountAt(ctx);
  if (mount && mount.label !== ctx.label) {
    ctx.report(`${ctx.shown} on the server is where another computer's folder is mounted, so nothing is mounted there`);
    return 3;
  }
  const previouslyMade = readState(ctx.dir)?.made ?? null;
  if (mount) {
    const verdict = await classify(ctx, mount);
    if (verdict === 'refuse') {
      ctx.report(`${ctx.mountPoint} is already mounted on the server`);
      return 3;
    }
    if (verdict === 'admit') {
      writeTrampoline(ctx.dir, ctx.attachCommand(ctx.dir));
      await ctx.offer.publish();
      writeOwner(ctx.dir, ctx.me);
      return 'poke';
    }
    const notEnded = retire(ctx, mount);
    if (notEnded !== null) {
      ctx.report(`cannot end the mount at ${ctx.mountPoint}: ${notEnded}`);
      return 3;
    }
    ctx.report(`replaced the mount at ${ctx.shown}; programs that were in it lost their folder`);
  } else {
    // A record without a mount: its sshfs is gone (or never mounted); nothing of it may linger.
    const state = readState(ctx.dir);
    killSshfs(ctx.system, state);
    removeFile(join(ctx.dir, STATE));
  }
  return await bootstrap(ctx, previouslyMade);
}

/**
 * Carries this connection for the mount until either side ends it, watching for a stall: a mount that has
 * not answered for MOUNT_DEAD_AFTER_MS while nothing came from the computer is ended here (stage 1: this
 * connection; stage 2: the mount itself if sshfs does not answer either), under the lock, and only while
 * this connection still carries the mount.
 */
async function carry(ctx: Context, poke: boolean): Promise<number> {
  const { system } = ctx;
  if (poke) {
    // sshfs reconnects on its next request: this one makes it come now, through this connection.
    void system.probe(ctx.mountPoint);
    const joined = await Promise.race([ctx.offer.joined, sleep(ATTACH_WAIT_MS).then(() => false)]);
    if (!joined) {
      ctx.offer.close();
      ctx.report(`sshfs did not come for this connection to ${ctx.shown}`);
      return 3;
    }
  }
  let code = 0;
  let escalation: Promise<void> = Promise.resolve();
  let watch: MountWatch | undefined;
  const startWatch = () => system.watchMount?.(ctx.mountPoint, {
    onAnswer: () => undefined,
    progress: () => ctx.offer.rxBytes(),
    onDead: () => {
      const rxAtDead = ctx.offer.rxBytes();
      escalation = withMountLock(ctx.dir, SERVE_LOCK_WAIT_MS, async () => {
        const owner = readOwner(ctx.dir);
        if (!owner || !sameProcess(owner.serve, ctx.me)) {
          // Another connection carries the mount now: only this one ends.
          ctx.offer.close();
          return;
        }
        // Data came while it waited for the lock: the connection is alive again (watched on while it lasts).
        if (ctx.offer.rxBytes() !== rxAtDead) {
          if (!carried) watch = startWatch();
          return;
        }
        code = 3;
        ctx.report(`${ctx.shown} did not answer for ${Math.round(MOUNT_DEAD_AFTER_MS / 1000)} s and nothing came from the computer, so this connection is ended; the computer connects again once it can`);
        ctx.offer.close();
        const result = await system.probe(ctx.mountPoint);
        if (result === 'silent' || result === 'dead') {
          const mount = mountAt(ctx);
          if (mount && mount.label === ctx.label) {
            const notEnded = retire(ctx, mount);
            ctx.report(notEnded === null
              ? `ended the mount at ${ctx.shown}, which did not answer either; programs that were in it lost their folder`
              : `cannot end the mount at ${ctx.shown}: ${notEnded}`);
          }
        }
        removeFile(join(ctx.dir, OWNER));
      }).catch(() => {
        ctx.offer.close();
      });
    },
  });
  let carried = false;
  watch = startWatch();
  await ctx.offer.ended;
  carried = true;
  watch?.stop();
  await escalation;
  return code;
}

/** Once this connection is over: let go of the mount, and end it if its place was withdrawn meanwhile. */
async function afterConnection(ctx: Context): Promise<void> {
  await withMountLock(ctx.dir, SERVE_LOCK_WAIT_MS, async () => {
    const owner = readOwner(ctx.dir);
    if (owner && sameProcess(owner.serve, ctx.me)) removeFile(join(ctx.dir, OWNER));
    const withdrawal = retireIfWithdrawn(ctx.dir, ctx.homeDir, ctx.system);
    if (withdrawal && 'ended' in withdrawal) ctx.report(`${ctx.shown} is no longer shared here, so its mount is ended`);
    if (withdrawal && 'failed' in withdrawal) ctx.report(withdrawal.failed);
  }).catch(() => undefined);
}

type Withdrawal = Readonly<{ ended: string } | { failed: string } | { unknown: true }> | null;

/**
 * Under the mount's lock: ends the mount recorded in `dir` if its place is no longer agreed to. Null when
 * nothing is to be done; `failed` keeps the record, so the next pass tries again.
 */
function retireIfWithdrawn(dir: string, homeDir: string, system: SharedFoldersServeSystem): Withdrawal {
  const state = readState(dir);
  if (!state) return null;
  // One reading decides; a record it cannot read now decides nothing, and the caller tries again.
  const agreement = readPlaceAgreement(homeDir, state.label, state.at);
  if (agreement === 'unknown') return { unknown: true };
  if (agreement === 'agreed') return null;
  const mount = listSharedFolderMounts(homeDir, system.readMountinfo())
    .find((candidate) => candidate.path === state.mountPoint && candidate.label === state.label);
  if (mount && (state.device === null || state.device === mount.device)) {
    const notEnded = retire({ dir, system, homeDir }, mount);
    if (notEnded !== null) return { failed: `cannot end the mount at ${state.mountPoint}: ${notEnded}` };
  } else {
    killSshfs(system, state);
    removeFile(join(dir, STATE));
    removeFile(join(dir, OWNER));
  }
  removeFoldersMadeFor(homeDir, system, state.mountPoint, state.made);
  return { ended: state.mountPoint };
}

/** A withdrawn place's folders go once empty, never through a folder another computer has mounted on the way since. */
function removeFoldersMadeFor(homeDir: string, system: SharedFoldersServeSystem, mountPoint: string, made: string | null): void {
  const onTheWay = listSharedFolderMounts(homeDir, system.readMountinfo()).some((candidate) => isWithin(mountPoint, candidate.path));
  // Nor through a symbolic link put on the way since: every part must still be a plain folder.
  if (onTheWay || serverPlaceProblem(homeDir, relative(homeDir, mountPoint)) !== null) return;
  removeEmptyFolders(mountPoint, made ?? mountPoint);
}

/**
 * This computer's mounts above `mountPoint` (a share moved inward, whose old mount is still there), outermost
 * first, each under its own lock and as the mount table lists it then: one that answers is kept and the
 * request refused, as before; otherwise it is ended with what is mounted inside it. Null when the way is
 * clear, otherwise why not.
 */
export async function retireMountsAbove(params: Readonly<{
  label: string;
  homeDir: string;
  happyHomeDir: string;
  mountPoint: string;
  system: SharedFoldersServeSystem;
}>): Promise<string | null> {
  const { system } = params;
  const above = listSharedFolderMounts(params.homeDir, system.readMountinfo())
    .filter((mount) => mount.label === params.label && mount.path !== params.mountPoint && isWithin(params.mountPoint, mount.path))
    .sort((left, right) => left.path.length - right.path.length);
  for (const outer of above) {
    const dir = persistentMountDir(params.happyHomeDir, outer.path);
    const refusal = await withMountLock(dir, SERVE_LOCK_WAIT_MS, async () => {
      // As it is now: it may be gone, or replaced meanwhile (another computer's is never touched).
      const mount = listSharedFolderMounts(params.homeDir, system.readMountinfo()).find((candidate) => candidate.path === outer.path);
      if (!mount) return null;
      if (mount.label !== params.label) return `${mount.path} on the server is a folder another computer shares`;
      // Only a mount whose place was withdrawn gives way, and only for a place still agreed (shares moved
      // twice in a row must not let a late request end the share that is back).
      if (!isPlaceAgreed(params.homeDir, params.label, relative(params.homeDir, params.mountPoint))
        || !isPlaceWithdrawn(params.homeDir, params.label, relative(params.homeDir, mount.path))) {
        return `${mount.path} is already mounted on the server`;
      }
      const marked = rxMark(dir);
      const result = await system.probe(mount.path);
      if (result === 'answers' || (result === 'silent' && rxMark(dir) !== marked)) return `${mount.path} is already mounted on the server`;
      // Asked again after the probe: the share may have moved back meanwhile.
      if (!isPlaceAgreed(params.homeDir, params.label, relative(params.homeDir, params.mountPoint))
        || !isPlaceWithdrawn(params.homeDir, params.label, relative(params.homeDir, mount.path))) {
        return `${mount.path} is already mounted on the server`;
      }
      const notEnded = retire({ dir, system, homeDir: params.homeDir }, mount);
      return notEnded === null ? null : `cannot end the mount at ${mount.path}: ${notEnded}`;
    }).catch((error: unknown) => `${outer.path} is busy on the server: ${error instanceof Error ? error.message : String(error)}`);
    if (refusal !== null) return refusal;
  }
  return null;
}

/**
 * Serves one connection of a computer for its placed folder (`serve.ts` checked the request, the agreement
 * and the way to the place). Returns the exit code of `serve`; its stderr is what the computer shows as
 * the reason a share is not connected.
 */
export async function servePersistentMount(params: Readonly<{
  label: string;
  folder: string;
  at: string;
  homeDir: string;
  happyHomeDir: string;
  input: Readable;
  output: Writable;
  attachCommand: (dir: string) => string;
  system: SharedFoldersServeSystem;
}>): Promise<number> {
  const { system } = params;
  const report = (message: string) => system.reportError(`piggercode shared folders: ${message}`);
  const mountPoint = join(params.homeDir, params.at);
  const dir = persistentMountDir(params.happyHomeDir, mountPoint);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The socket is bound by its short name in the mount's directory (a long home path stays usable).
  process.chdir(dir);
  const me = system.ownIdentity();
  if (!me) {
    report('cannot read this process on the server');
    return 3;
  }
  const ctx: Context = {
    label: params.label,
    folder: params.folder,
    at: params.at,
    homeDir: params.homeDir,
    mountPoint,
    dir,
    shown: `~/${params.at}`,
    me,
    offer: createOffer({ dir, input: params.input, output: params.output }),
    attachCommand: params.attachCommand,
    system,
    report,
  };
  let admitted: number | 'carry' | 'poke';
  try {
    admitted = await withMountLock(dir, SERVE_LOCK_WAIT_MS, async () => await admit(ctx));
  } catch (error) {
    ctx.offer.close();
    report(`${ctx.shown} is busy on the server: ${error instanceof Error ? error.message : String(error)}`);
    return 3;
  }
  if (typeof admitted === 'number') {
    ctx.offer.close();
    return admitted;
  }
  const code = await carry(ctx, admitted === 'poke');
  await afterConnection(ctx);
  return code;
}

/**
 * `piggercode machine shared-folders attach --dir <dir>`, run by a persistent mount's sshfs (through
 * `attach.sh`) when it connects: joins its stdin and stdout to the computer's connection waiting on the
 * mount's socket. With none there (a socket whose `serve` is gone) it removes that socket, so the next try
 * fails at once in the script, and exits 1, which sshfs turns into EIO. It never touches the mount.
 */
export async function runPersistentMountAttach(params: Readonly<{ dir: string; input: Readable; output: Writable }>): Promise<number> {
  let target: string;
  try {
    process.chdir(params.dir);
    // Resolved once: the socket joined is the one cleaned up if nobody listens there.
    target = readlinkSync(SOCK);
  } catch {
    return 1;
  }
  return await new Promise<number>((resolve) => {
    const socket = connect(target);
    let joined = false;
    let done = false;
    // Either side ending, or failing, ends the connection: sshfs then sees its end and reconnects later.
    const finish = (code: number) => {
      if (done) return;
      done = true;
      params.input.unpipe(socket);
      socket.destroy();
      resolve(code);
    };
    params.input.on('error', () => finish(0));
    params.output.on('error', () => finish(0));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (!joined && error.code === 'ECONNREFUSED') {
        try {
          unlinkSync(target);
        } catch {
          // Another took it away already.
        }
      }
      finish(joined ? 0 : 1);
    });
    socket.once('connect', () => {
      joined = true;
      params.input.pipe(socket);
      socket.pipe(params.output);
      socket.once('close', () => finish(0));
      params.input.once('end', () => finish(0));
      params.input.once('close', () => finish(0));
      params.output.once('close', () => finish(0));
    });
  });
}

/**
 * Ends the persistent mounts at places no longer agreed to (a share stopped or moved), each under its lock.
 * The daemon runs it after the agreement changed and when it starts; `serve` does the same for its own
 * mount when its connection ends. Returns the mount paths it ended, and the mounts it could not lock now,
 * to try again.
 */
export async function clearWithdrawnPersistentMounts(params: Readonly<{
  homeDir: string;
  happyHomeDir: string;
  system: SharedFoldersServeSystem;
  lockWaitMs?: number;
}>): Promise<Readonly<{ ended: string[]; busy: string[]; failed: string[] }>> {
  const root = persistentMountsDir(params.happyHomeDir);
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { ended: [], busy: [], failed: [] };
  }
  const records = names
    .map((name) => ({ dir: join(root, name), state: readState(join(root, name)) }))
    .filter((entry): entry is { dir: string; state: MountState } => entry.state !== null);
  const ended: string[] = [];
  const busy: string[] = [];
  const busyPaths: string[] = [];
  // One reading per record; one it cannot read now decides nothing, is tried again later, and keeps the
  // mounts around it as they are meanwhile.
  const withdrawn = records.filter((entry) => {
    const agreement = readPlaceAgreement(params.homeDir, entry.state.label, entry.state.at);
    if (agreement === 'unknown') {
      busy.push(entry.dir);
      busyPaths.push(entry.state.mountPoint);
    }
    return agreement === 'withdrawn';
  })
    // Deepest first: ending an outer mount first would detach the inner ones.
    .sort((left, right) => right.state.mountPoint.length - left.state.mountPoint.length);
  const failed: string[] = [];
  for (const { dir, state } of withdrawn) {
    // An outer mount waits while one inside it is busy: ending it would detach that one under its holder.
    if (busyPaths.some((path) => isWithin(path, state.mountPoint))) {
      busy.push(dir);
      busyPaths.push(state.mountPoint);
      continue;
    }
    try {
      const withdrawal = await withMountLock(dir, params.lockWaitMs ?? WITHDRAW_LOCK_WAIT_MS, async () => retireIfWithdrawn(dir, params.homeDir, params.system));
      if (withdrawal && 'ended' in withdrawal) ended.push(withdrawal.ended);
      if (withdrawal && 'failed' in withdrawal) failed.push(withdrawal.failed);
      if (withdrawal && ('failed' in withdrawal || 'unknown' in withdrawal)) {
        busy.push(dir);
        busyPaths.push(state.mountPoint);
      }
    } catch {
      busy.push(dir);
      busyPaths.push(state.mountPoint);
    }
  }
  return { ended, busy, failed };
}

/**
 * `clearWithdrawnPersistentMounts` until no withdrawn place's mount is left busy, trying again every
 * WITHDRAW_RETRY_MS: an accepted withdrawal is carried out even when the `serve` holding that mount's lock is
 * killed before it gets to it. Runs in the daemon, after the agreement changed and once when it starts; ends
 * early once `stopped` says so.
 */
export async function clearWithdrawnPersistentMountsUntilDone(params: Readonly<{
  homeDir: string;
  happyHomeDir: string;
  system: SharedFoldersServeSystem;
  stopped: () => boolean;
  onEnded: (mountPoint: string) => void;
  onFailed: (reason: string) => void;
}>): Promise<void> {
  while (!params.stopped()) {
    const { ended, busy, failed } = await clearWithdrawnPersistentMounts(params);
    for (const path of ended) params.onEnded(path);
    for (const reason of failed) params.onFailed(reason);
    if (busy.length === 0) return;
    await sleep(WITHDRAW_RETRY_MS);
  }
}
