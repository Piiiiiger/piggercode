import { spawn } from 'node:child_process';

/** How often the server end of a shared folder asks its mount whether it answers. */
export const MOUNT_WATCH_INTERVAL_MS = 20_000;

/**
 * How long one request to a shared folder may go unanswered, with no data moving through the connection either,
 * before the connection counts as dead. A big copy over a slow link queues requests ahead of the probe for minutes
 * while its data keeps moving; a sleeping computer's mount moves nothing, and otherwise hangs everything that
 * touches it for hours.
 */
export const MOUNT_DEAD_AFTER_MS = 90_000;

export type MountWatch = Readonly<{ stop: () => void }>;

/** A request to a mount: it settles once the mount answered it (or its connection was ended). */
export type PatientMountProbe = Readonly<{ exited: Promise<void>; kill?: () => void }>;

/**
 * A `stat` of `path` started outside it and left to run until the mount answers. It is never killed on a
 * timer: a request a dead connection's sshfs has not even taken yet would give way to a kill, and the mount
 * would look as if it had answered.
 */
export function startPatientMountProbe(path: string): PatientMountProbe {
  const child = spawn('stat', ['-t', path], { cwd: '/', stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
  return { exited, kill: () => void child.kill('SIGKILL') };
}

/**
 * Watches the mount at `path` while its connection lasts. A computer that sleeps, or a connection that
 * stalls, leaves the mount hanging: every process that touches it waits (a daemon too) until the connection
 * is ended, which the SSH session alone may not notice for hours. Every MOUNT_WATCH_INTERVAL_MS this asks the
 * mount with a probe from outside it (`startPatientMountProbe`, one at a time), and calls `onDead` once a probe has
 * gone MOUNT_DEAD_AFTER_MS without coming back while `progress` (a count that grows as data moves through the
 * connection) has not changed for as long either: a busy connection is not a dead one (2026-11-11: copies of tens
 * of MB over a slow link held the probe past 90 s, and ending the connection failed them). A probe that comes back
 * late, or with an error, still shows the mount answers: only one that hangs counts. `onAnswer` is called whenever
 * a probe comes back.
 */
export function watchMount(params: Readonly<{
  path: string;
  onDead: () => void;
  onAnswer?: () => void;
  /** Grows while data moves through the connection; null (or absent) where that cannot be seen. */
  progress?: () => number | null;
  probe?: (path: string) => PatientMountProbe;
  now?: () => number;
  intervalMs?: number;
  deadAfterMs?: number;
}>): MountWatch {
  const probe = params.probe ?? startPatientMountProbe;
  const now = params.now ?? Date.now;
  const intervalMs = params.intervalMs ?? MOUNT_WATCH_INTERVAL_MS;
  const deadAfterMs = params.deadAfterMs ?? MOUNT_DEAD_AFTER_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: { startedAt: number; probe: PatientMountProbe } | null = null;
  let lastProgress = params.progress?.() ?? null;
  let movedAt = now();

  const schedule = (): void => {
    timer = setTimeout(tick, intervalMs);
    timer.unref?.();
  };
  function tick(): void {
    timer = null;
    if (stopped) return;
    const progress = params.progress?.() ?? null;
    if (progress !== null && progress !== lastProgress) {
      lastProgress = progress;
      movedAt = now();
    }
    if (running === null) {
      const entry = { startedAt: now(), probe: probe(params.path) };
      running = entry;
      void entry.probe.exited.then(() => {
        if (running === entry) running = null;
        if (!stopped) params.onAnswer?.();
      });
    } else if (now() - running.startedAt >= deadAfterMs && now() - movedAt >= deadAfterMs) {
      stopped = true;
      params.onDead();
      return;
    }
    schedule();
  }

  schedule();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // A probe the connection still holds ends with it; one that is merely slow is not needed any more.
      running?.probe.kill?.();
    },
  };
}
