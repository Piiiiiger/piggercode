import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';

import { watchMount, type MountWatch } from './mountWatchdog';
import { probeMount, readMountinfo, type MountProbeResult } from './sharedFolderMounts';

/**
 * What `serve` (and the daemon, when it clears a withdrawn place) asks of this server's OS about mounts and
 * processes: the one seam its tests replace (`serve.ts`, `persistentMount.ts`). Linux only, like `serve`.
 */

/** A process as this boot knows it: a pid alone may name another process later. */
export type ProcessIdentity = Readonly<{ bootId: string; pid: number; startTicks: string }>;

export function sameProcess(left: ProcessIdentity | null | undefined, right: ProcessIdentity | null | undefined): boolean {
  return !!left && !!right && left.bootId === right.bootId && left.pid === right.pid && left.startTicks === right.startTicks;
}

export type SharedFoldersServeSystem = Readonly<{
  readMountinfo: () => string;
  /**
   * What the mount at `path` says to one request only the computer can answer, within
   * MOUNT_ANSWER_TIMEOUT_MS, never waiting longer: a request a dead connection's sshfs already took holds its
   * caller, beyond even SIGKILL, until that connection is ended, so a probe that does not answer is left
   * behind to end with it.
   */
  probe: (path: string) => Promise<MountProbeResult>;
  /**
   * Ends the FUSE connection behind a mount (`device` as mountinfo gives it, `0:47`): null once ended,
   * otherwise why it could not be.
   */
  abortConnection: (device: string) => string | null;
  /**
   * Whether the FUSE connection behind a mount is still there (it goes when its sshfs exits or it is ended);
   * null where that cannot be seen (fusectl is not mounted).
   */
  connectionExists: (device: string) => boolean | null;
  unmount: (path: string) => void;
  /**
   * Runs a passive sshfs with these arguments on this process's stdin and stdout; resolves with its exit code.
   * An aborted `signal` ends it; `onStarted` gets its process id.
   */
  runSshfs: (args: readonly string[], signal?: AbortSignal, onStarted?: (pid: number) => void) => Promise<number>;
  /**
   * Starts an sshfs that outlives this process (its own session, stderr into `logPath`); `exited` settles
   * with its exit code if it ends while this process is still here.
   */
  startSshfs: (args: readonly string[], logPath: string) => Readonly<{ pid: number | null; exited: Promise<number | null> }>;
  /** The process `pid` is now, or null when there is none (or only its zombie). */
  processIdentity: (pid: number) => ProcessIdentity | null;
  /** This process (`serve`), as `processIdentity` names it. */
  ownIdentity: () => ProcessIdentity | null;
  kill: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  reportError: (message: string) => void;
  /** Watches the mount while sshfs serves it (`watchMount`); none where not given. */
  watchMount?: (
    path: string,
    handlers: Readonly<{ onDead: () => void; onAnswer: () => void; progress: () => number | null }>,
  ) => MountWatch;
  /** Bytes the process has written so far (Linux `/proc/<pid>/io`), or null where that cannot be read. */
  bytesWrittenBy?: (pid: number) => number | null;
}>;

function readBootId(): string {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

/** `/proc/<pid>/stat`: the state is the first field after the name, the start time (in clock ticks) the 20th. */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z' || fields[0] === 'X') return null;
    const startTicks = fields[19];
    if (!startTicks) return null;
    return { bootId: readBootId(), pid, startTicks };
  } catch {
    return null;
  }
}

const FUSECTL_PATH = '/sys/fs/fuse/connections';

/** fusectl names a connection by its device, which for FUSE (major 0) is the minor number. */
function fuseConnectionMinor(device: string): string | null {
  return /^0:(\d+)$/.exec(device)?.[1] ?? null;
}

export const osServeSystem: SharedFoldersServeSystem = {
  readMountinfo,
  probe: probeMount,
  abortConnection: (device) => {
    const minor = fuseConnectionMinor(device);
    if (!minor) return `unexpected device ${device}`;
    try {
      writeFileSync(`${FUSECTL_PATH}/${minor}/abort`, '1');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  connectionExists: (device) => {
    const minor = fuseConnectionMinor(device);
    if (minor === null) return false;
    // Only fusectl mounted where it is looked up shows anything (its folder may be there, empty, without it).
    const fusectlThere = readMountinfo().split('\n').some((line) => {
      const fields = line.split(' ');
      return fields[4] === FUSECTL_PATH && fields[fields.indexOf('-', 6) + 1] === 'fusectl';
    });
    if (!fusectlThere) return null;
    return existsSync(`${FUSECTL_PATH}/${minor}`);
  },
  unmount: (path) => {
    const result = spawnSyncQuiet('fusermount3', ['-uz', path]);
    if (result !== 0) spawnSyncQuiet('fusermount', ['-uz', path]);
  },
  runSshfs: async (args, signal, onStarted) => await new Promise<number>((resolve) => {
    const child = spawn('sshfs', [...args], { stdio: 'inherit' });
    if (child.pid !== undefined) onStarted?.(child.pid);
    // sshfs ends by itself once its FUSE connection is aborted; a kill makes sure.
    const end = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    };
    signal?.addEventListener('abort', end, { once: true });
    child.once('error', (error) => {
      process.stderr.write(`piggercode shared folders: cannot run sshfs: ${error.message}\n`);
      resolve(127);
    });
    child.once('exit', (code) => {
      signal?.removeEventListener('abort', end);
      resolve(code ?? 1);
    });
  }),
  startSshfs: (args, logPath) => {
    const log = openSync(logPath, 'w', 0o600);
    try {
      const child = spawn('sshfs', [...args], { detached: true, stdio: ['ignore', 'ignore', log] });
      const exited = new Promise<number | null>((resolve) => {
        child.once('exit', (code) => resolve(code));
        child.once('error', () => resolve(127));
      });
      child.unref();
      return { pid: child.pid ?? null, exited };
    } finally {
      closeSync(log);
    }
  },
  processIdentity: readProcessIdentity,
  ownIdentity: () => readProcessIdentity(process.pid),
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch {
      // Gone already.
    }
  },
  watchMount: (path, handlers) => watchMount({ path, ...handlers }),
  bytesWrittenBy: (pid) => {
    try {
      const written = /^wchar:\s*(\d+)$/m.exec(readFileSync(`/proc/${pid}/io`, 'utf8'));
      return written ? Number(written[1]) : null;
    } catch {
      return null;
    }
  },
  reportError: (message) => {
    process.stderr.write(`${message}\n`);
  },
};

function spawnSyncQuiet(command: string, args: readonly string[]): number | null {
  return spawnSync(command, [...args], { stdio: 'ignore' }).status;
}
