import { join } from 'node:path';

import { withJsonOwnerFileLock } from '@/utils/fs/jsonOwnerFileLock';

/**
 * Exclusion around one trashed copy (trash, restore, delete, reconcile). Several daemons of one user can share
 * the trash directory, so the in-process queue is backed by the CLI's owner-checked file lock
 * (`withJsonOwnerFileLock`): a lock is taken over only when its owner process is gone, a just-created lock is
 * never stale, and a release removes only a lock the caller still owns.
 */

const LOCK_WAIT_MS = 2 * 60_000;
const LOCK_STALE_AFTER_MS = 10 * 60_000;

const queues = new Map<string, Promise<unknown>>();

/** Runs `run` with exclusive use of the copy `key` across this process's callers and other processes sharing `lockDir`. */
export async function withCopyLock<T>(lockDir: string, key: string, run: () => Promise<T>): Promise<T> {
  const queueKey = `${lockDir}\0${key}`;
  const previous = queues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => (
    await withJsonOwnerFileLock({
      lockPath: join(lockDir, `${key}.lock`),
      timeoutMs: LOCK_WAIT_MS,
      staleAfterMs: LOCK_STALE_AFTER_MS,
      errorCode: 'session_trash_busy',
      pollIntervalMs: 50,
    }, run)
  ));
  queues.set(queueKey, next);
  try {
    return await next;
  } finally {
    if (queues.get(queueKey) === next) queues.delete(queueKey);
  }
}
