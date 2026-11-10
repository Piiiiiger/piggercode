import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_TRASH_RETENTION_MS } from '@piggercode/protocol';

vi.mock('@/configuration', () => ({
  configuration: { activeServerDir: '/tmp/happier-test-active-server', happyHomeDir: '/tmp/happier-test-home', serverUrl: 'https://server.test', logsDir: '/tmp' },
}));

import type { DirectSessionProviderOps } from '@/backends/directSessions/providerOps';
import { DirectSessionsProviderUnsupportedError } from '@/backends/directSessions/providerOps';
import {
  deleteDirectSessionForGood,
  directSessionTrashDigest,
  readTrashedCopyDigests,
  reconcileTrashedDirectSessions,
  restoreTrashedDirectSession,
  TRASH_HEAL_GRACE_MS,
  trashDirectSession,
} from './directSessionTrash';

const DAY_MS = 24 * 60 * 60 * 1000;
const source = { kind: 'codexHome', home: 'user' } as const;
const AUTH = 'https://server-a\0acct-1';

function createOps(overrides: Partial<DirectSessionProviderOps> = {}) {
  const calls: string[] = [];
  const ops = {
    listCandidates: async () => ({ candidates: [], nextCursor: null }),
    trashCandidate: async ({ remoteSessionId }: { remoteSessionId: string }) => { calls.push(`trash:${remoteSessionId}`); },
    restoreCandidate: async ({ remoteSessionId }: { remoteSessionId: string }) => { calls.push(`restore:${remoteSessionId}`); },
    deleteCandidate: async ({ remoteSessionId }: { remoteSessionId: string }) => { calls.push(`delete:${remoteSessionId}`); },
    ...overrides,
  } as DirectSessionProviderOps;
  return { ops, calls };
}

async function listEntryFiles(root: string): Promise<string[]> {
  const days = await readdir(root).catch(() => [] as string[]);
  const files: string[] = [];
  for (const day of days) {
    for (const name of await readdir(join(root, day))) files.push(`${day}/${name}`);
  }
  return files;
}

describe('direct session trash', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'piggercode-direct-session-trash-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('moves the provider copy aside and files an entry under the local day it was trashed', async () => {
    const { ops, calls } = createOps();
    const nowMs = new Date(2026, 10, 8, 13, 0, 0).getTime();

    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, nowMs, root });

    expect(calls).toEqual(['trash:thread-1']);
    const files = await listEntryFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^2026-11-08\/codex-[0-9a-f]{32}\.json$/);

    // Trashing again settles without moving the copy twice or changing the date.
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, nowMs: nowMs + DAY_MS, root });
    expect(calls).toEqual(['trash:thread-1']);
    expect(await listEntryFiles(root)).toEqual(files);
  });

  it('keeps no entry when the provider cannot move the copy aside', async () => {
    const { ops } = createOps({ trashCandidate: async () => { throw new Error('boom'); } });
    await expect(trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, root })).rejects.toThrow('boom');
    expect(await listEntryFiles(root)).toEqual([]);
  });

  it('restores the provider copy and drops the entry; restoring something never trashed succeeds', async () => {
    const { ops, calls } = createOps();
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, root });

    await restoreTrashedDirectSession({ providerId: 'codex', source, remoteSessionId: 'thread-1', ops, root });
    expect(calls).toEqual(['trash:thread-1', 'restore:thread-1']);
    expect(await listEntryFiles(root)).toEqual([]);

    await restoreTrashedDirectSession({ providerId: 'codex', source, remoteSessionId: 'never-trashed', ops, root });
    expect(calls).toEqual(['trash:thread-1', 'restore:thread-1']);
  });

  it('deleting for good puts a trashed copy back first, deletes it and drops the entry', async () => {
    const { ops, calls } = createOps();
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, root });

    await deleteDirectSessionForGood({ providerId: 'codex', source, remoteSessionId: 'thread-1', ops, root });

    expect(calls).toEqual(['trash:thread-1', 'restore:thread-1', 'delete:thread-1']);
    expect(await listEntryFiles(root)).toEqual([]);
  });

  it('deletes an expired copy only when the server says its session is gone, heals a live one, and skips what it cannot confirm', async () => {
    const nowMs = new Date(2026, 10, 20, 12, 0, 0).getTime();
    const { ops, calls } = createOps({
      deleteCandidate: async ({ remoteSessionId }) => {
        if (remoteSessionId === 'flaky') throw new Error('provider busy');
        calls.push(`delete:${remoteSessionId}`);
      },
    });
    const old = nowMs - SESSION_TRASH_RETENTION_MS - 1000;
    const place = (id: string, trashedAtMs: number) => trashDirectSession({ sessionId: `sess-${id}`, authority: AUTH, providerId: 'codex', source, remoteSessionId: id, ops, nowMs: trashedAtMs, root });
    await place('old', old);
    await place('flaky', old);
    await place('offline', old);
    await place('live-expired', old);
    await place('live-recent', nowMs - TRASH_HEAL_GRACE_MS - 1000);
    await place('gone-recent', nowMs - TRASH_HEAL_GRACE_MS - 1000);
    await place('in-flight', nowMs - 60_000);
    calls.length = 0;
    const asked: string[] = [];
    const states: Record<string, 'gone' | 'live' | 'error'> = {
      'sess-old': 'gone', 'sess-flaky': 'gone', 'sess-offline': 'error',
      'sess-live-expired': 'live', 'sess-live-recent': 'live', 'sess-gone-recent': 'gone', 'sess-in-flight': 'live',
    };

    const result = await reconcileTrashedDirectSessions({
      nowMs,
      authority: AUTH,
      resolveOps: async () => ops,
      confirmSessionState: async (sessionId) => {
        asked.push(sessionId);
        if (states[sessionId] === 'error') throw new Error('server unreachable');
        return states[sessionId] as 'gone' | 'live';
      },
      root,
    });

    expect(result).toEqual({ pruned: 1, healed: 2, failed: 2 });
    expect(calls.filter((c) => c.startsWith('delete:'))).toEqual(['delete:old']);
    expect(calls).toContain('restore:live-expired');
    expect(calls).toContain('restore:live-recent');
    expect(calls).not.toContain('restore:in-flight');
    // An entry still inside the heal grace is not even looked up; a recent one the server has gone from is kept.
    expect(asked).not.toContain('sess-in-flight');
    const remaining = await readTrashedCopyDigests(root);
    expect(remaining.has(directSessionTrashDigest('codex', JSON.stringify(source), 'gone-recent'))).toBe(true);
    expect(remaining.has(directSessionTrashDigest('codex', JSON.stringify(source), 'offline'))).toBe(true);
    expect(remaining.has(directSessionTrashDigest('codex', JSON.stringify(source), 'flaky'))).toBe(true);
    expect(remaining.has(directSessionTrashDigest('codex', JSON.stringify(source), 'old'))).toBe(false);
  });

  it('leaves files it cannot read alone', async () => {
    await mkdir(join(root, '2026-01-01'), { recursive: true });
    await writeFile(join(root, '2026-01-01', 'junk.json'), 'not json');
    const { ops } = createOps();
    const result = await reconcileTrashedDirectSessions({ nowMs: Date.now(), authority: AUTH, resolveOps: async () => ops, confirmSessionState: async () => 'gone', root });
    expect(result).toEqual({ pruned: 0, healed: 0, failed: 0 });
    expect(await listEntryFiles(root)).toEqual(['2026-01-01/junk.json']);
  });

  it('keeps same-id copies in different stores apart', async () => {
    const { ops, calls } = createOps({ resolveCopyIdentity: async ({ source }) => `store:${(source as { configDir: string }).configDir}` });
    const storeA = { kind: 'claudeConfig', configDir: '/tmp/a', projectId: null } as const;
    const storeB = { kind: 'claudeConfig', configDir: '/tmp/b', projectId: null } as const;
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'claude', source: storeA, remoteSessionId: 'thread-1', ops, root });
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'claude', source: storeB, remoteSessionId: 'thread-1', ops, root });
    expect(calls).toEqual(['trash:thread-1', 'trash:thread-1']);
    expect(await listEntryFiles(root)).toHaveLength(2);

    await restoreTrashedDirectSession({ providerId: 'claude', source: storeB, remoteSessionId: 'thread-1', ops, root });
    expect(await listEntryFiles(root)).toHaveLength(1);
    const left = await readTrashedCopyDigests(root);
    expect(left.has(directSessionTrashDigest('claude', 'store:/tmp/a', 'thread-1'))).toBe(true);
    expect(left.has(directSessionTrashDigest('claude', 'store:/tmp/b', 'thread-1'))).toBe(false);
  });

  it('never deletes a copy that was restored while a prune pass was already waiting for it', async () => {
    const nowMs = new Date(2026, 10, 20, 12, 0, 0).getTime();
    let releaseRestore!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRestore = resolve; });
    let restoreStarted = false;
    const { ops, calls } = createOps({
      restoreCandidate: async ({ remoteSessionId }) => { restoreStarted = true; await gate; calls.push(`restore:${remoteSessionId}`); },
    });
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, nowMs: nowMs - SESSION_TRASH_RETENTION_MS - 1000, root });
    calls.length = 0;

    const restoring = restoreTrashedDirectSession({ providerId: 'codex', source, remoteSessionId: 'thread-1', ops, root });
    await vi.waitFor(() => expect(restoreStarted).toBe(true));
    const pruning = reconcileTrashedDirectSessions({ nowMs, authority: AUTH, resolveOps: async () => ops, confirmSessionState: async () => 'gone', root });
    releaseRestore();
    await restoring;
    const result = await pruning;

    expect(calls).toEqual(['restore:thread-1']);
    expect(result).toEqual({ pruned: 0, healed: 0, failed: 0 });
  });

  it('reports a provider with no trash operation as unsupported, not as a failure to move', async () => {
    const { ops } = createOps({ trashCandidate: undefined });
    await expect(trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'claude', source: { kind: 'claudeConfig', configDir: '/tmp', projectId: null }, remoteSessionId: 's', ops, root }))
      .rejects.toBeInstanceOf(DirectSessionsProviderUnsupportedError);
  });

  it('leaves entries of another server or account, and entries without an owner, alone', async () => {
    const nowMs = new Date(2026, 10, 20, 12, 0, 0).getTime();
    const { ops, calls } = createOps();
    const old = nowMs - SESSION_TRASH_RETENTION_MS - 1000;
    await trashDirectSession({ sessionId: 's-a', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'mine', ops, nowMs: old, root });
    await trashDirectSession({ sessionId: 's-b', authority: 'https://server-b\0acct-1', providerId: 'codex', source, remoteSessionId: 'other-server', ops, nowMs: old, root });
    await trashDirectSession({ sessionId: 's-c', authority: 'https://server-a\0acct-2', providerId: 'codex', source, remoteSessionId: 'other-account', ops, nowMs: old, root });
    const legacyDir = join(root, '2026-01-01');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, `codex-${directSessionTrashDigest('codex', JSON.stringify(source), 'legacy')}.json`), JSON.stringify({
      v: 1, providerId: 'codex', source, copyIdentity: JSON.stringify(source), sessionId: 's-d', remoteSessionId: 'legacy', trashedAtMs: old,
    }));
    calls.length = 0;
    const asked: string[] = [];

    const result = await reconcileTrashedDirectSessions({
      nowMs,
      authority: AUTH,
      resolveOps: async () => ops,
      confirmSessionState: async (sessionId) => { asked.push(sessionId); return 'gone'; },
      root,
    });

    expect(result).toEqual({ pruned: 1, healed: 0, failed: 0 });
    expect(asked).toEqual(['s-a']);
    expect(calls.filter((c) => c.startsWith('delete:'))).toEqual(['delete:mine']);
  });

  it('renews the heal grace on a trash retry without moving the retention age', async () => {
    const nowMs = new Date(2026, 10, 20, 12, 0, 0).getTime();
    const { ops, calls } = createOps();
    const first = nowMs - 3 * 24 * 60 * 60 * 1000;
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, nowMs: first, root });
    // A retry a minute ago: the copy is already moved, so only the attempt time changes.
    await trashDirectSession({ sessionId: 'sess-1', authority: AUTH, providerId: 'codex', source, remoteSessionId: 'thread-1', ops, nowMs: nowMs - 60_000, root });
    expect(calls).toEqual(['trash:thread-1']);
    calls.length = 0;

    const asked: string[] = [];
    const result = await reconcileTrashedDirectSessions({
      nowMs,
      authority: AUTH,
      resolveOps: async () => ops,
      confirmSessionState: async (id) => { asked.push(id); return 'live'; },
      root,
    });

    // Not healed (the retry is in flight), not even looked up.
    expect(result).toEqual({ pruned: 0, healed: 0, failed: 0 });
    expect(asked).toEqual([]);
    const [file] = await listEntryFiles(root);
    expect(file).toMatch(/^2026-11-17\//); // filed under the first trash day
  });
});
