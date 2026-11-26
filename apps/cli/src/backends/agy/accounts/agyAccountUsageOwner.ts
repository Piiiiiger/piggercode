import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AGY_DEFAULT_ACCOUNT_ID,
  AgyAccountUsageV1Schema,
  type AgyAccountUsageReportV1,
  type AgyAccountUsageV1,
} from '@piggercode/protocol';
import { z } from 'zod';

import { logger } from '@/ui/logger';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';

import type { AgyAccountUsageReading } from './readAgyAccountUsageFromStatus';

/**
 * A login folder's name reaches synced app settings, so it can be neither an email address nor a path. A folder
 * whose name does not match (a login still being added starts with a dot) is not a login.
 */
export const AGY_LOGIN_FOLDER_NAME = /^[A-Za-z0-9_-]{1,40}$/;

const StoredUsageSchema = z.object({ v: z.literal(1), accounts: z.array(AgyAccountUsageV1Schema) });

export type AgyAccountHome = Readonly<{ accountId: string; homeDir: string }>;

export type AgyAccountUsageOwner = Readonly<{
  /** What a running session showed. Sessions run on the default login. */
  record: (report: AgyAccountUsageReportV1) => Promise<void>;
  /** Every login on this machine, with the limits agy last showed for it. */
  read: () => Promise<readonly AgyAccountUsageV1[]>;
  /** The refresh button: starts agy once on this login. True when it reported the limits. */
  refresh: (accountId: string) => Promise<boolean>;
  /** What agy showed for a login when it was just signed in. */
  recordReading: (accountId: string, reading: AgyAccountUsageReading) => Promise<void>;
  /** A removed login's reading goes with it, so a later login of that name starts with nothing of it. */
  forget: (accountId: string) => Promise<void>;
}>;

/**
 * This machine's agy logins and their last readings, in one local file. Nothing here starts agy on its own.
 * File access runs one request at a time, so two sessions reporting at once cannot overwrite each other.
 */
export function createAgyAccountUsageOwner(params: Readonly<{
  storePath: string;
  defaultHomeDir: string;
  accountsDir: string;
  isAgyInstalled: () => boolean;
  platform?: NodeJS.Platform;
  probe: (home: AgyAccountHome) => Promise<AgyAccountUsageReading | null>;
  now?: () => number;
}>): AgyAccountUsageOwner {
  const now = params.now ?? Date.now;
  let accounts: readonly AgyAccountUsageV1[] | null = null;
  let turn: Promise<unknown> = Promise.resolve();
  const refreshing = new Map<string, Promise<boolean>>();

  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const result = turn.then(work);
    turn = result.catch(() => undefined);
    return result;
  };

  const load = async (): Promise<readonly AgyAccountUsageV1[]> => {
    if (accounts) return accounts;
    // Only "no file yet" and a damaged file start empty. A read that failed for now throws, so the next
    // save cannot drop the other accounts.
    const raw = await readFile(params.storePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      logger.infoFile('[agy-accounts] Could not read the saved usage', error.message);
      throw error;
    });
    if (raw === null) {
      accounts = [];
      return accounts;
    }
    let saved: unknown = null;
    try {
      saved = JSON.parse(raw);
    } catch {
      // Reported below, with any other shape it cannot use.
    }
    const parsed = StoredUsageSchema.safeParse(saved);
    if (!parsed.success) logger.infoFile('[agy-accounts] The saved usage is damaged: starting over');
    accounts = parsed.success ? parsed.data.accounts : [];
    return accounts;
  };

  const store = async (accountId: string, report: AgyAccountUsageReportV1): Promise<void> => {
    const current = await load();
    const existing = current.find((account) => account.accountId === accountId);
    if (existing && (existing.observedAtMs ?? 0) > report.observedAtMs) return;
    const next: AgyAccountUsageV1 = {
      accountId,
      email: report.email ?? existing?.email ?? null,
      // A plan belongs to its Google account: another account signed in here does not inherit it.
      planTier: report.planTier
        ?? (report.email === null || report.email === existing?.email ? existing?.planTier ?? null : null),
      observedAtMs: report.observedAtMs,
      meters: report.meters,
    };
    accounts = existing ? current.map((account) => (account === existing ? next : account)) : [...current, next];
    await writeJsonAtomic(params.storePath, { v: 1, accounts }).catch((error: unknown) => {
      logger.infoFile('[agy-accounts] Could not save the usage', error instanceof Error ? error.message : String(error));
    });
  };

  /**
   * Each folder in the accounts directory, or link to one, is a login's home, named by the folder. Linux only:
   * elsewhere agy can keep its sign-in in a keyring that a separate `HOME` does not separate.
   */
  const listAddedHomes = async (): Promise<AgyAccountHome[]> => {
    if ((params.platform ?? process.platform) !== 'linux') return [];
    const names = await readdir(params.accountsDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') logger.infoFile('[agy-accounts] Could not list the logins', error.message);
      return [] as string[];
    });
    const homes = await Promise.all(names
      .filter((name) => AGY_LOGIN_FOLDER_NAME.test(name) && name !== AGY_DEFAULT_ACCOUNT_ID)
      .sort()
      .map(async (name) => {
        const homeDir = await realpath(join(params.accountsDir, name)).catch(() => null);
        if (!homeDir) return null;
        const info = await stat(homeDir).catch(() => null);
        return info?.isDirectory() ? { accountId: name, homeDir } : null;
      }));
    return homes.filter((home) => home !== null);
  };

  /** Which entry an added login's name stands for: a removed or replaced login gets a new one (a link counts itself). */
  const entryOf = (accountId: string) => lstat(join(params.accountsDir, accountId))
    .then((info) => `${info.dev}:${info.ino}`, () => null);

  const readAgy = async (accountId: string): Promise<boolean> => {
    const home = accountId === AGY_DEFAULT_ACCOUNT_ID
      ? (params.isAgyInstalled() ? { accountId, homeDir: params.defaultHomeDir } : null)
      : (await listAddedHomes()).find((candidate) => candidate.accountId === accountId) ?? null;
    if (!home) return false;
    const entry = accountId === AGY_DEFAULT_ACCOUNT_ID ? null : await entryOf(accountId);
    // Removed between the listing and now: nothing to read for it.
    if (accountId !== AGY_DEFAULT_ACCOUNT_ID && entry === null) return false;
    const reading = await params.probe(home);
    if (!reading) return false;
    // agy ran for seconds: a login removed or replaced meanwhile does not get this reading back under its name.
    return await inTurn(async () => {
      if (entry !== null && (await entryOf(accountId)) !== entry) {
        logger.infoFile('[agy-accounts] A login changed while it was read: its reading is dropped');
        return false;
      }
      await store(accountId, { ...reading, meters: [...reading.meters], observedAtMs: now() });
      return true;
    });
  };

  const recordReading = (accountId: string, reading: AgyAccountUsageReading) => inTurn(
    () => store(accountId, { ...reading, meters: [...reading.meters], observedAtMs: now() }),
  );

  return {
    record: (report) => inTurn(() => store(AGY_DEFAULT_ACCOUNT_ID, report)),
    read: () => inTurn(async () => {
      const saved = new Map((await load()).map((account) => [account.accountId, account]));
      const ids = [
        ...(saved.has(AGY_DEFAULT_ACCOUNT_ID) || params.isAgyInstalled() ? [AGY_DEFAULT_ACCOUNT_ID] : []),
        ...(await listAddedHomes()).map((home) => home.accountId),
      ];
      return ids.map((accountId) => saved.get(accountId)
        ?? { accountId, email: null, planTier: null, observedAtMs: null, meters: [] });
    }),
    recordReading,
    forget: (accountId) => inTurn(async () => {
      const current = await load();
      if (!current.some((account) => account.accountId === accountId)) return;
      accounts = current.filter((account) => account.accountId !== accountId);
      await writeJsonAtomic(params.storePath, { v: 1, accounts }).catch((error: unknown) => {
        logger.infoFile('[agy-accounts] Could not save the usage', error instanceof Error ? error.message : String(error));
      });
    }),
    refresh: (accountId) => {
      // Two screens pressing at once start agy once. The probe has a deadline, so this always settles.
      const running = refreshing.get(accountId);
      if (running) return running;
      const started = readAgy(accountId)
        .catch((error: unknown) => {
          logger.infoFile('[agy-accounts] Reading a login failed', error instanceof Error ? error.message : String(error));
          return false;
        })
        .finally(() => {
          refreshing.delete(accountId);
        });
      refreshing.set(accountId, started);
      return started;
    },
  };
}
