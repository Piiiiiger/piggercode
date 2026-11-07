import { startMountProbe, type MountProbe } from './sharedFolderMounts';

/** How often the server end of a shared folder asks its mount whether it answers. */
export const MOUNT_WATCH_INTERVAL_MS = 20_000;

/**
 * How long a shared folder may go without answering before its connection counts as dead. Long enough for
 * a slow but working connection (a big copy queues requests ahead of the probe), far shorter than the hours
 * a sleeping computer's mount otherwise hangs everything that touches it.
 */
export const MOUNT_DEAD_AFTER_MS = 90_000;

export type MountWatch = Readonly<{ stop: () => void }>;

/**
 * Watches the mount at `path` while its connection lasts. A computer that sleeps, or a connection that
 * stalls, leaves the mount hanging: every process that touches it waits (a daemon too) until the connection
 * is ended, which the SSH session alone may not notice for hours. This asks the mount every
 * MOUNT_WATCH_INTERVAL_MS with a probe from outside it (`startMountProbe`, one at a time: a probe a dead
 * connection holds counts as a miss until it ends) and calls `onDead` once, after MOUNT_DEAD_AFTER_MS
 * without an answer. Any answer starts the count again.
 */
export function watchMount(params: Readonly<{
  path: string;
  onDead: () => void;
  /** Called after each answer. */
  onAnswer?: () => void;
  probe?: (path: string) => MountProbe;
  now?: () => number;
  intervalMs?: number;
  deadAfterMs?: number;
}>): MountWatch {
  const probe = params.probe ?? startMountProbe;
  const now = params.now ?? Date.now;
  const intervalMs = params.intervalMs ?? MOUNT_WATCH_INTERVAL_MS;
  const deadAfterMs = params.deadAfterMs ?? MOUNT_DEAD_AFTER_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let probeRunning = false;
  let firstMissAt: number | null = null;

  const schedule = (): void => {
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref?.();
  };
  const tick = async (): Promise<void> => {
    timer = null;
    if (stopped) return;
    let answered = false;
    if (!probeRunning) {
      probeRunning = true;
      const started = probe(params.path);
      void started.exited.then(() => {
        probeRunning = false;
      });
      answered = await started.answers;
    }
    if (stopped) return;
    if (answered) {
      firstMissAt = null;
      params.onAnswer?.();
    } else {
      firstMissAt ??= now();
      if (now() - firstMissAt >= deadAfterMs) {
        stopped = true;
        params.onDead();
        return;
      }
    }
    schedule();
  };

  schedule();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
