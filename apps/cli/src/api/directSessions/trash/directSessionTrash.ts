import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DirectSessionsProviderIdSchema,
  DirectSessionsSourceSchema,
  SESSION_TRASH_RETENTION_MS,
  createServerUrlComparableKey,
  type DirectSessionsProviderId,
  type DirectSessionsSource,
} from '@piggercode/protocol';
import { z } from 'zod';

import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';
import { configuration } from '@/configuration';
import {
  DirectSessionsProviderUnsupportedError,
  type DirectSessionProviderOps,
} from '@/backends/directSessions/providerOps';
import { logger } from '@/utils/logger';

import { validateDirectMachineSource } from '../security/validateDirectMachineSource';
import { withCopyLock } from './copyLock';

/**
 * The machine's side of the session trash (回收站). Trashing a linked session moves the provider's own copy
 * aside through the provider (`trashCandidate`) and records an entry under
 * `<happy home>/trash/direct-sessions/<YYYY-MM-DD>/` (the day it was trashed, local time) with what is needed
 * to put it back. The provider keeps the transcript itself; an entry only says where it came from and when.
 *
 * Restore puts the copy back and drops the entry; deleting for good (the user's 彻底删除, or the reconciliation
 * once an entry is `SESSION_TRASH_RETENTION_DAYS` old and the server confirms the session is gone) deletes the provider copy and drops the entry. Each step is
 * idempotent so a retry after a failure settles.
 */

const DirectSessionTrashEntrySchema = z.object({
  v: z.literal(1),
  providerId: DirectSessionsProviderIdSchema,
  source: DirectSessionsSourceSchema,
  /** Which provider store the copy lives in (a Codex home), so two stores holding the same thread id stay apart. */
  copyIdentity: z.string().min(1),
  /** The PiggerCode session this copy belongs to; the daemon asks the server about it before it deletes or heals the copy. */
  sessionId: z.string().min(1),
  /** The server and account that own `sessionId` (`resolveTrashAuthority`); only a daemon of that authority may delete or heal the copy. Entries without one are left alone. */
  authority: z.string().min(1).optional(),
  remoteSessionId: z.string().min(1),
  /** When the copy was first trashed: retention counts from here. */
  trashedAtMs: z.number().int().nonnegative(),
  /** The latest trash attempt, retries included: the heal grace counts from here, so a retry in flight is not undone. */
  lastAttemptAtMs: z.number().int().nonnegative().optional(),
});
export type DirectSessionTrashEntry = z.infer<typeof DirectSessionTrashEntrySchema>;

type TrashTarget = Readonly<{
  /** The PiggerCode session (used when trashing, to record it in the entry). */
  sessionId?: string;
  providerId: DirectSessionsProviderId;
  source: DirectSessionsSource;
  remoteSessionId: string;
}>;

/** The server and account a daemon acts for: the trash is shared by every daemon of the user, and an entry belongs to one authority. */
export function resolveTrashAuthority(token: string): string | null {
  const subject = decodeJwtPayload(token)?.sub;
  return typeof subject === 'string' && subject.trim()
    ? `${createServerUrlComparableKey(configuration.serverUrl)}\0${subject.trim()}`
    : null;
}

export function resolveDirectSessionTrashRoot(): string {
  return join(configuration.happyHomeDir, 'trash', 'direct-sessions');
}

function formatLocalDay(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The key of one provider copy: provider, the store it lives in (`copyIdentity`) and its remote id. Remote ids
 * are provider-defined strings, so the entry file name is a digest of the key. Codex carry-forward accounts
 * hold copies with the same thread id in different homes; the identity keeps them apart.
 */
export function directSessionTrashDigest(providerId: string, copyIdentity: string, remoteSessionId: string): string {
  return createHash('sha256').update(`${providerId}\0${copyIdentity}\0${remoteSessionId}`).digest('hex').slice(0, 32);
}

function entryFileName(providerId: string, digest: string): string {
  return `${providerId}-${digest}.json`;
}

/** The provider's own name for the store a source points at; sources of providers without one are told apart by shape. */
async function resolveCopyIdentity(ops: DirectSessionProviderOps, source: DirectSessionsSource): Promise<string> {
  return ops.resolveCopyIdentity ? await ops.resolveCopyIdentity({ source }) : JSON.stringify(source);
}

/** Lock files live beside the trash root, so they never look like day directories. */
function lockDirFor(root: string): string {
  return `${root}.locks`;
}

async function listDayDirectories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readEntry(path: string): Promise<DirectSessionTrashEntry | null> {
  try {
    const parsed = DirectSessionTrashEntrySchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function findEntry(root: string, providerId: string, digest: string): Promise<{ path: string; entry: DirectSessionTrashEntry } | null> {
  const fileName = entryFileName(providerId, digest);
  for (const day of await listDayDirectories(root)) {
    const path = join(root, day, fileName);
    const entry = await readEntry(path);
    if (entry) return { path, entry };
  }
  return null;
}

/** The keys of every trashed copy, for the provider browsers to leave out of their lists. */
export async function readTrashedCopyDigests(root: string = resolveDirectSessionTrashRoot()): Promise<ReadonlySet<string>> {
  const digests = new Set<string>();
  for (const day of await listDayDirectories(root)) {
    let names: string[];
    try {
      names = await readdir(join(root, day));
    } catch {
      continue;
    }
    for (const name of names) {
      const entry = await readEntry(join(root, day, name));
      if (entry) digests.add(directSessionTrashDigest(entry.providerId, entry.copyIdentity, entry.remoteSessionId));
    }
  }
  return digests;
}

function requireOp<TOp>(op: TOp | undefined, providerId: string, operation: string): TOp {
  if (!op) {
    throw new DirectSessionsProviderUnsupportedError(
      `Agent '${providerId}' does not support direct-session ${operation} for this source.`,
    );
  }
  return op;
}

type CopyOperation = TrashTarget & Readonly<{ ops: DirectSessionProviderOps; root?: string }>;

async function locateCopy(params: CopyOperation) {
  const root = params.root ?? resolveDirectSessionTrashRoot();
  const copyIdentity = await resolveCopyIdentity(params.ops, params.source);
  const digest = directSessionTrashDigest(params.providerId, copyIdentity, params.remoteSessionId);
  return { root, copyIdentity, digest, lockKey: `${params.providerId}-${digest}` };
}

export async function trashDirectSession(params: CopyOperation & Readonly<{ sessionId: string; authority: string; nowMs?: number }>): Promise<void> {
  const { root, copyIdentity, digest, lockKey } = await locateCopy(params);
  await withCopyLock(lockDirFor(root), lockKey, async () => {
    const existing = await findEntry(root, params.providerId, digest);
    if (existing) {
      // A retry of a trash that already moved the copy: renew the heal grace (under this lock), keep the retention age.
      const renewed: DirectSessionTrashEntry = {
        ...existing.entry,
        sessionId: params.sessionId,
        authority: params.authority,
        lastAttemptAtMs: params.nowMs ?? Date.now(),
      };
      await writeFile(existing.path, JSON.stringify(renewed), 'utf8');
      return;
    }

    await requireOp(params.ops.trashCandidate, params.providerId, 'trash')({
      source: params.source,
      remoteSessionId: params.remoteSessionId,
    });

    const trashedAtMs = params.nowMs ?? Date.now();
    const dayDir = join(root, formatLocalDay(trashedAtMs));
    await mkdir(dayDir, { recursive: true });
    const entry: DirectSessionTrashEntry = {
      v: 1,
      providerId: params.providerId,
      source: params.source,
      copyIdentity,
      sessionId: params.sessionId,
      authority: params.authority,
      remoteSessionId: params.remoteSessionId,
      trashedAtMs,
      lastAttemptAtMs: trashedAtMs,
    };
    await writeFile(join(dayDir, entryFileName(params.providerId, digest)), JSON.stringify(entry), 'utf8');
  });
}

/** Restoring a copy that has no entry (never trashed on this machine, or restored already) succeeds. */
export async function restoreTrashedDirectSession(params: CopyOperation): Promise<void> {
  const { root, digest, lockKey } = await locateCopy(params);
  await withCopyLock(lockDirFor(root), lockKey, async () => {
    const found = await findEntry(root, params.providerId, digest);
    if (!found) return;
    await requireOp(params.ops.restoreCandidate, params.providerId, 'restore')({
      source: found.entry.source,
      remoteSessionId: params.remoteSessionId,
    });
    await rm(found.path, { force: true });
  });
}

/**
 * Deletes the provider copy for good and drops its trash entry. A trashed copy is put back in the provider's
 * own list first (a failure there is not fatal: the delete below is the step that must succeed), so the
 * provider deletes it the way it deletes any other session.
 */
export async function deleteDirectSessionForGood(params: CopyOperation): Promise<void> {
  const { root, digest, lockKey } = await locateCopy(params);
  await withCopyLock(lockDirFor(root), lockKey, async () => {
    await deleteCopyInsideLock(params, await findEntry(root, params.providerId, digest));
  });
}

async function deleteCopyInsideLock(params: CopyOperation, found: { path: string } | null): Promise<void> {
  if (found && params.ops.restoreCandidate) {
    await params.ops.restoreCandidate({ source: params.source, remoteSessionId: params.remoteSessionId }).catch(() => undefined);
  }
  await requireOp(params.ops.deleteCandidate, params.providerId, 'candidate deletion')({
    source: params.source,
    remoteSessionId: params.remoteSessionId,
  });
  if (found) await rm(found.path, { force: true });
}

function lastAttemptOf(entry: DirectSessionTrashEntry): number {
  return Math.max(entry.trashedAtMs, entry.lastAttemptAtMs ?? 0);
}

/** Heal only entries older than this: a trash whose server half is still in flight must not be undone. */
export const TRASH_HEAL_GRACE_MS = 10 * 60_000;

/** What the server says about the PiggerCode session an entry belongs to: `gone` (404: in the trash, purged or deleted) or `live`. */
export type TrashedSessionServerState = 'gone' | 'live';

/**
 * The machine's hourly reconciliation of its trash with the server, for every entry older than the heal grace:
 * - the server session is `live` (the server-side trash never happened, or the session came back without this
 *   machine): the provider copy is put back, so a failed trash cannot leave a live session without its copy;
 * - the server session is `gone` and the entry is older than `SESSION_TRASH_RETENTION_DAYS`: the provider copy
 *   is deleted for good. A copy is never deleted on age alone;
 * - the server cannot be asked (offline, error), or the entry has no confirmation yet: nothing changes, and the
 *   next run tries again.
 * The entry and its age are read again inside the copy's lock, so a copy restored or trashed again after the
 * scan is left alone. A machine that was off catches up on its next run.
 */
export async function reconcileTrashedDirectSessions(params: Readonly<{
  nowMs: number;
  resolveOps: (providerId: DirectSessionsProviderId) => Promise<DirectSessionProviderOps>;
  confirmSessionState: (sessionId: string) => Promise<TrashedSessionServerState>;
  /** The caller's own `resolveTrashAuthority`: entries of any other server or account, or with none, are not touched. */
  authority: string;
  env?: NodeJS.ProcessEnv;
  root?: string;
}>): Promise<Readonly<{ pruned: number; healed: number; failed: number }>> {
  const root = params.root ?? resolveDirectSessionTrashRoot();
  const expiredBeforeMs = params.nowMs - SESSION_TRASH_RETENTION_MS;
  const healBeforeMs = params.nowMs - TRASH_HEAL_GRACE_MS;
  let pruned = 0;
  let healed = 0;
  let failed = 0;
  for (const day of await listDayDirectories(root)) {
    const dayDir = join(root, day);
    let names: string[];
    try {
      names = await readdir(dayDir);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(dayDir, name);
      const scanned = await readEntry(path);
      if (!scanned || scanned.authority !== params.authority || lastAttemptOf(scanned) > healBeforeMs) continue;
      const digest = directSessionTrashDigest(scanned.providerId, scanned.copyIdentity, scanned.remoteSessionId);
      try {
        const outcome = await withCopyLock(lockDirFor(root), `${scanned.providerId}-${digest}`, async () => {
          const entry = await readEntry(path);
          if (!entry || entry.authority !== params.authority || lastAttemptOf(entry) > healBeforeMs) return 'skipped' as const;
          const state = await params.confirmSessionState(entry.sessionId);
          const expired = entry.trashedAtMs <= expiredBeforeMs;
          if (state === 'gone' && !expired) return 'skipped' as const;
          const validated = validateDirectMachineSource({
            providerId: entry.providerId,
            source: entry.source,
            env: params.env ?? process.env,
          });
          if (!validated.ok) throw new Error(validated.error);
          const ops = await params.resolveOps(entry.providerId);
          if (state === 'live') {
            await requireOp(ops.restoreCandidate, entry.providerId, 'restore')({
              source: validated.source,
              remoteSessionId: entry.remoteSessionId,
            });
            await rm(path, { force: true });
            return 'healed' as const;
          }
          await deleteCopyInsideLock({
            providerId: entry.providerId,
            source: validated.source,
            remoteSessionId: entry.remoteSessionId,
            ops,
            root,
          }, { path });
          return 'pruned' as const;
        });
        if (outcome === 'pruned') pruned += 1;
        if (outcome === 'healed') healed += 1;
      } catch (error) {
        failed += 1;
        logger.debug('[directSessions.trash] could not reconcile a trashed session; will retry', error);
      }
    }
    // Drop a day directory once its last entry is gone.
    await rmdir(dayDir).catch(() => undefined);
  }
  return { pruned, healed, failed };
}
