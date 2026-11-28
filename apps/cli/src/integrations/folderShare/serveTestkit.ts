import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';

import { runSharedFoldersServe } from './serve';
import type { ProcessIdentity, SharedFoldersServeSystem } from './serveSystem';
import type { MountProbeResult } from './sharedFolderMounts';

/**
 * Test seam for `serve` (`serve.ts`, `persistentMount.ts`): this server's OS, faked at its boundary (the
 * mount table, sshfs, fusectl, processes), with real files, locks and Unix sockets in a throwaway home. A
 * persistent sshfs is faked the way it behaves: it connects through the mount's `sock` when it starts and,
 * after its connection is gone, again on the next request, which fails with EIO while nothing is offered.
 */

const originalCwd = process.cwd();
const homes: string[] = [];

/** `serve` works in its mount's directory; the test process goes back before the homes are removed. */
export function cleanUpServeHomes(): void {
  process.chdir(originalCwd);
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
}

export function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-serve-'));
  homes.push(home);
  return home;
}

// A throwaway public key (its private half was never kept).
const COMPUTER_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';

/** The server's record that it agrees to `places` for the computer `label`: its line in authorized_keys. */
export function agree(home: string, label: string, places: readonly string[]): void {
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  const file = join(home, '.ssh', 'authorized_keys');
  const comment = `piggercode-shared-folders:machine-${label}`;
  const others = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line && !line.endsWith(comment)) : [];
  const command = `/srv/piggercode machine shared-folders serve --label ${label}${places.map((place) => ` --place '${place}'`).join('')}`;
  writeFileSync(file, [...others, `restrict,command="${command}" ${COMPUTER_KEY} ${comment}`, ''].join('\n'), { mode: 0o600 });
}

export type MountedEntry = string | Readonly<{ path: string; source: string }>;

/** A persistent mount's fake sshfs. */
export type FakeSshfs = {
  pid: number;
  mountPoint: string;
  dir: string;
  /** Its connection to a `serve`, while it has one. */
  socket: Socket | null;
  /** Requests get no answer (the computer stalled behind its connection). */
  stalled: boolean;
  /** Its requests are not even taken (a wedged sshfs). */
  wedged: boolean;
  alive: boolean;
  /** Its mount's device once it mounted. */
  device: string | null;
  /** What reached it from the computer. */
  received: string;
};

/** One connection of the computer: what it sends (`input`) and what reaches it (`output`). */
export type ServedConnection = Readonly<{
  input: PassThrough;
  output: PassThrough;
  /** Everything that reached the computer so far. */
  received: () => string;
  done: Promise<number>;
  identity: ProcessIdentity;
  /** Ignores SIGTERM (a `serve` stuck in the kernel); SIGKILL still ends it. */
  ignoreTerm: { value: boolean };
}>;

export function createServeSystem(options: Readonly<{
  mounted?: MountedEntry | readonly MountedEntry[];
  /** How a mount with no fake sshfs behind it (a passive one, or unknown) answers a probe. */
  mountAnswers?: boolean;
  abortFails?: string;
  onUnmount?: () => void;
  onSshfs?: () => void;
  /** False: a persistent sshfs exits at once without mounting, writing this to its log. */
  sshfsMounts?: boolean;
}> = {}) {
  const calls = {
    sshfs: [] as string[][],
    unmounted: [] as string[],
    errors: [] as string[],
    steps: [] as string[],
    probed: [] as string[],
    killed: [] as Array<[number, string]>,
    watches: [] as Array<{ path: string; handlers: { onDead: () => void; onAnswer: () => void; progress: () => number | null } }>,
  };
  let nextDevice = 43;
  const listed = options.mounted === undefined ? [] : Array.isArray(options.mounted) ? options.mounted : [options.mounted as MountedEntry];
  const mounted = listed.map((entry) => {
    const mount = typeof entry === 'string' ? { path: entry, source: ':code' } : entry;
    return { ...mount, device: `0:${nextDevice++}` };
  });
  const aborted = new Set<string>();
  const fakes: FakeSshfs[] = [];
  const alive = new Map<number, ProcessIdentity>();
  const onKill = new Map<number, (signal: 'SIGTERM' | 'SIGKILL') => void>();
  let nextPid = 5000;

  const fakeAt = (path: string) => fakes.find((fake) => fake.alive && fake.mountPoint === path && mounted.some((mount) => mount.path === path));
  /** The fake sshfs comes through whatever connection the mount's `sock` offers now. */
  const connectFake = async (fake: FakeSshfs) => await new Promise<boolean>((resolve) => {
    let target: string;
    try {
      target = readlinkSync(join(fake.dir, 'sock'));
    } catch {
      resolve(false);
      return;
    }
    // By its short name from the mount's directory, as `attach` does: a long temp home is no problem.
    const previous = process.cwd();
    process.chdir(fake.dir);
    const socket = connect(target);
    process.chdir(previous);
    socket.once('connect', () => {
      fake.socket = socket;
      socket.on('data', (chunk: Buffer) => {
        fake.received += chunk.toString('utf8');
      });
      socket.once('close', () => {
        if (fake.socket !== socket) return;
        fake.socket = null;
        // A stall is the connection's: the next one starts clear.
        fake.stalled = false;
      });
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

  const system: SharedFoldersServeSystem = {
    readMountinfo: () => [
      '22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw',
      ...mounted.map((mount, index) => `${36 + index} 25 ${mount.device} / ${mount.path.replace(/ /g, '\\040')} rw,nosuid,nodev - fuse.sshfs ${mount.source} rw,user_id=1000`),
      '',
    ].join('\n'),
    probe: async (path): Promise<MountProbeResult> => {
      calls.probed.push(path);
      const fake = fakeAt(path);
      if (!fake) return options.mountAnswers === true ? 'answers' : 'silent';
      if (fake.wedged) return 'silent';
      if (fake.stalled) {
        // The request waits on the stalled connection: it fails with EIO once that connection is ended, and
        // otherwise gets no answer (the real probe gives up after MOUNT_ANSWER_TIMEOUT_MS; here, 300 ms).
        const deadline = Date.now() + 300;
        while (fake.socket && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
        return fake.socket ? 'silent' : 'disconnected';
      }
      // A connection just ended is seen as gone a moment later (sshfs reads its end first).
      if (fake.socket) await new Promise((resolve) => setTimeout(resolve, 20));
      if (fake.socket) return 'answers';
      // No connection: sshfs runs its script for this request, which joins an offered connection or fails.
      return (await connectFake(fake)) ? 'answers' : 'disconnected';
    },
    abortConnection: (device) => {
      calls.steps.push(`abort ${device}`);
      if (options.abortFails) return options.abortFails;
      aborted.add(device);
      return null;
    },
    connectionExists: (device): boolean | null => {
      if (aborted.has(device)) return false;
      const mount = mounted.find((candidate) => candidate.device === device);
      if (!mount) return false;
      const fake = fakes.find((candidate) => candidate.device === device);
      return fake ? fake.alive : true;
    },
    unmount: (path) => {
      calls.steps.push('unmount');
      calls.unmounted.push(path);
      // Unmounting detaches it and everything mounted under it.
      for (let index = mounted.length - 1; index >= 0; index -= 1) {
        const entry = mounted[index]!;
        if (entry.path === path || entry.path.startsWith(`${path}/`)) mounted.splice(index, 1);
      }
      options.onUnmount?.();
    },
    runSshfs: async (args) => {
      calls.steps.push('sshfs');
      calls.sshfs.push([...args]);
      options.onSshfs?.();
      return 0;
    },
    startSshfs: (args, logPath) => {
      calls.steps.push('sshfs');
      calls.sshfs.push([...args]);
      options.onSshfs?.();
      const pid = nextPid++;
      alive.set(pid, { bootId: 'boot', pid, startTicks: `sshfs-${pid}` });
      const optionList = args[2] ?? '';
      const script = /ssh_command=\/bin\/sh ([^,]+)/.exec(optionList)?.[1] ?? '';
      const source = /fsname=([^,]+)/.exec(optionList)?.[1] ?? '';
      const fake: FakeSshfs = {
        pid, mountPoint: args[args.length - 1]!, dir: dirname(script), socket: null, stalled: false, wedged: false, alive: true, device: null, received: '',
      };
      fakes.push(fake);
      let resolveExit: (code: number | null) => void = () => undefined;
      const exited = new Promise<number | null>((resolve) => {
        resolveExit = resolve;
      });
      const end = (code: number | null) => {
        fake.alive = false;
        alive.delete(pid);
        fake.socket?.destroy();
        resolveExit(code);
      };
      onKill.set(pid, () => end(null));
      if (options.sshfsMounts === false) {
        setImmediate(() => {
          writeFileSync(logPath, 'read: Connection reset by peer\n');
          end(1);
        });
      } else {
        // Its first connection is made at start; it mounts once that is through.
        void connectFake(fake).then((through) => {
          if (!through) {
            end(1);
            return;
          }
          fake.device = `0:${nextDevice++}`;
          mounted.push({ path: fake.mountPoint, source, device: fake.device });
        });
      }
      return { pid, exited };
    },
    processIdentity: (pid) => alive.get(pid) ?? null,
    ownIdentity: () => null,
    kill: (pid, signal) => {
      calls.killed.push([pid, signal]);
      onKill.get(pid)?.(signal);
    },
    reportError: (message) => {
      calls.errors.push(message);
    },
    watchMount: (path, handlers) => {
      calls.watches.push({ path, handlers });
      return { stop: () => undefined };
    },
  };

  /** Another mount appears, as the mount table will list it from now on. */
  const mount = (entry: Readonly<{ path: string; source: string }>) => {
    mounted.push({ ...entry, device: `0:${nextDevice++}` });
  };

  /**
   * One connection of the computer to `serve` for `request`, as its own process (an identity of its own,
   * which a kill ends: its connection closes with it).
   */
  const serve = (home: string, request: string | undefined, label = 'laptop'): ServedConnection => {
    const pid = nextPid++;
    const identity: ProcessIdentity = { bootId: 'boot', pid, startTicks: `serve-${pid}` };
    alive.set(pid, identity);
    const input = new PassThrough();
    const output = new PassThrough();
    let received = '';
    output.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
    });
    const ignoreTerm = { value: false };
    onKill.set(pid, (signal) => {
      if (signal === 'SIGTERM' && ignoreTerm.value) return;
      alive.delete(pid);
      input.end();
    });
    const done = runSharedFoldersServe({
      label,
      originalCommand: request,
      homeDir: home,
      happyHomeDir: join(home, '.piggercode'),
      input,
      output,
      attachCommand: (dir) => `attach --dir '${dir}'`,
      system: { ...system, ownIdentity: () => (alive.has(pid) ? identity : null) },
    }).finally(() => {
      alive.delete(pid);
    });
    return { input, output, received: () => received, done, identity, ignoreTerm };
  };

  return { system, calls, mount, serve, fakes };
}

/** Waits until `condition` holds (the fakes and `serve` work on real sockets and timers). */
export async function eventually(condition: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** `serve` for `request` with this system, on a connection nobody uses (it ends when `serve` does). */
export async function serveRequest(home: string, request: string | undefined, system: SharedFoldersServeSystem, label = 'laptop'): Promise<number> {
  return await runSharedFoldersServe({
    label,
    originalCommand: request,
    homeDir: home,
    happyHomeDir: join(home, '.piggercode'),
    input: new PassThrough(),
    output: new PassThrough(),
    attachCommand: (dir) => `attach --dir '${dir}'`,
    system: { ...system, ownIdentity: () => ({ bootId: 'boot', pid: process.pid, startTicks: 'serve-request' }) },
  });
}
