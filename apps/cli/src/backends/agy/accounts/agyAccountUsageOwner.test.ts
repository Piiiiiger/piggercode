import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgyAccountUsageReportV1 } from '@piggercode/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgyAccountUsageOwner,
  type AgyAccountHome,
} from './agyAccountUsageOwner';
import type { AgyAccountUsageReading } from './readAgyAccountUsageFromStatus';

const dirs: string[] = [];

async function tempPaths() {
  const dir = await mkdtemp(join(tmpdir(), 'agy-account-usage-'));
  dirs.push(dir);
  const defaultHomeDir = join(dir, 'home');
  const accountsDir = join(dir, 'accounts');
  await mkdir(defaultHomeDir);
  return { dir, storePath: join(dir, 'usage.json'), defaultHomeDir, accountsDir };
}

type Paths = Awaited<ReturnType<typeof tempPaths>>;

function ownerAt(paths: Paths, options: Readonly<{
  installed?: boolean;
  probe?: (home: AgyAccountHome) => Promise<AgyAccountUsageReading | null>;
  now?: () => number;
  platform?: NodeJS.Platform;
}> = {}) {
  return createAgyAccountUsageOwner({
    storePath: paths.storePath,
    defaultHomeDir: paths.defaultHomeDir,
    accountsDir: paths.accountsDir,
    isAgyInstalled: () => options.installed ?? true,
    platform: options.platform ?? 'linux',
    probe: options.probe ?? (async () => null),
    ...(options.now ? { now: options.now } : {}),
  });
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function report(
  email: string | null,
  remainingFraction: number,
  observedAtMs: number,
  planTier: string | null = 'pro',
): AgyAccountUsageReportV1 {
  return {
    email,
    planTier,
    observedAtMs,
    meters: [{ meterId: 'gemini-5h', remainingFraction, resetAtMs: 9_000 }],
  };
}

const reading = (email: string, remainingFraction: number): AgyAccountUsageReading => ({
  email,
  planTier: 'pro',
  meters: [{ meterId: 'gemini-5h', remainingFraction, resetAtMs: 9_000 }],
});

describe('createAgyAccountUsageOwner', () => {
  it('lists the real home and each login folder, with no numbers until agy showed them', async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.accountsDir, 'b'), { recursive: true });
    await writeFile(join(paths.accountsDir, 'not-a-folder'), 'x');
    await mkdir(join(paths.accountsDir, '.hidden'));
    await mkdir(join(paths.accountsDir, 'work@example.com'));

    expect(await ownerAt(paths).read()).toEqual([
      { accountId: 'default', email: null, planTier: null, observedAtMs: null, meters: [] },
      { accountId: 'b', email: null, planTier: null, observedAtMs: null, meters: [] },
    ]);
  });

  it('lists no separate login off Linux, where a separate home does not separate a keyring', async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.accountsDir, 'b'), { recursive: true });
    const probe = vi.fn(async (_home: AgyAccountHome) => reading('b@example.com', 0.25));
    const owner = ownerAt(paths, { platform: 'darwin', probe });
    expect((await owner.read()).map((account) => account.accountId)).toEqual(['default']);
    await expect(owner.refresh('b')).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('still shows the real home\'s login when the logins folder cannot be read', async () => {
    const paths = await tempPaths();
    await writeFile(paths.accountsDir, 'not a folder');
    const owner = ownerAt(paths);
    await owner.record(report('one@example.com', 0.9, 1_000));
    expect((await owner.read()).map((account) => account.email)).toEqual(['one@example.com']);
  });

  it('lists no login on a machine without agy', async () => {
    expect(await ownerAt(await tempPaths(), { installed: false }).read()).toEqual([]);
  });

  it('keeps a session\'s reading on the real home\'s login across a restart', async () => {
    const paths = await tempPaths();
    const owner = ownerAt(paths);
    await owner.record(report('one@example.com', 0.9, 1_000));
    await owner.record(report('one@example.com', 0.8, 3_000));
    const before = await owner.read();
    expect(before.map((account) => [account.accountId, account.email, account.meters[0]?.remainingFraction]))
      .toEqual([['default', 'one@example.com', 0.8]]);

    expect(await ownerAt(paths).read()).toEqual(before);
  });

  it('saves only the login, its account, plan, limits and when they were seen', async () => {
    const paths = await tempPaths();
    await ownerAt(paths).record(report('one@example.com', 0.9, 1_000));
    const [account] = JSON.parse(await readFile(paths.storePath, 'utf8')).accounts;
    expect(Object.keys(account).sort()).toEqual(['accountId', 'email', 'meters', 'observedAtMs', 'planTier']);
    expect(account.accountId).toBe('default');
  });

  it('does not let a late older reading replace a newer one', async () => {
    const owner = ownerAt(await tempPaths());
    await owner.record(report('one@example.com', 0.5, 2_000));
    await owner.record(report('one@example.com', 0.9, 1_000));
    expect((await owner.read())[0]?.meters[0]?.remainingFraction).toBe(0.5);
  });

  it('keeps the account and plan when a later reading does not say them', async () => {
    const owner = ownerAt(await tempPaths());
    await owner.record(report('one@example.com', 0.9, 1_000, 'pro'));
    await owner.record(report(null, 0.8, 2_000, null));
    const [account] = await owner.read();
    expect(account).toMatchObject({ email: 'one@example.com', planTier: 'pro' });
    expect(account?.meters[0]?.remainingFraction).toBe(0.8);
  });

  it('does not give another Google account signed in here the old one\'s plan', async () => {
    const owner = ownerAt(await tempPaths());
    await owner.record(report('pro@example.com', 0.9, 1_000, 'pro'));
    await owner.record(report('free@example.com', 0.8, 2_000, null));
    expect((await owner.read())[0]).toMatchObject({ email: 'free@example.com', planTier: null });
  });

  it('refresh starts agy once on that login\'s home and leaves the others alone', async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.accountsDir, 'b'), { recursive: true });
    const probe = vi.fn(async (_home: AgyAccountHome) => reading('b@example.com', 0.25));
    const owner = ownerAt(paths, { probe, now: () => 5_000 });
    await owner.record(report('one@example.com', 0.9, 1_000));

    await expect(owner.refresh('b')).resolves.toBe(true);

    expect(probe.mock.calls.map(([home]) => home)).toEqual([
      { accountId: 'b', homeDir: await realpath(join(paths.accountsDir, 'b')) },
    ]);
    const accounts = await owner.read();
    expect(accounts.map((account) => [account.accountId, account.email, account.observedAtMs])).toEqual([
      ['default', 'one@example.com', 1_000],
      ['b', 'b@example.com', 5_000],
    ]);
  });

  it('refreshes the real home\'s login in the real home', async () => {
    const paths = await tempPaths();
    const probe = vi.fn(async (_home: AgyAccountHome) => reading('one@example.com', 0.5));
    await expect(ownerAt(paths, { probe }).refresh('default')).resolves.toBe(true);
    expect(probe.mock.calls[0]?.[0]).toEqual({ accountId: 'default', homeDir: paths.defaultHomeDir });
  });

  it('takes a link to a folder as a login', async () => {
    const paths = await tempPaths();
    const elsewhere = join(paths.dir, 'elsewhere');
    await mkdir(elsewhere);
    await mkdir(paths.accountsDir);
    await symlink(elsewhere, join(paths.accountsDir, 'b'));
    const probe = vi.fn(async (_home: AgyAccountHome) => reading('b@example.com', 0.25));
    await ownerAt(paths, { probe }).refresh('b');
    expect(probe.mock.calls[0]?.[0].homeDir).toBe(await realpath(elsewhere));
  });

  it('starts nothing for a login that is not on this machine', async () => {
    const paths = await tempPaths();
    const probe = vi.fn(async (_home: AgyAccountHome) => reading('x@example.com', 0.5));
    const owner = ownerAt(paths, { probe });
    await expect(owner.refresh('../elsewhere')).resolves.toBe(false);
    await expect(owner.refresh('missing')).resolves.toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('starts agy once for two presses at the same time', async () => {
    const paths = await tempPaths();
    let answer: (value: AgyAccountUsageReading) => void = () => {};
    const probe = vi.fn(() => new Promise<AgyAccountUsageReading>((resolve) => {
      answer = resolve;
    }));
    const owner = ownerAt(paths, { probe });
    const presses = [owner.refresh('default'), owner.refresh('default')];
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    answer(reading('one@example.com', 0.5));
    await expect(Promise.all(presses)).resolves.toEqual([true, true]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('keeps the last numbers when a refresh reads nothing, and can refresh again', async () => {
    const paths = await tempPaths();
    const probe = vi.fn<(home: AgyAccountHome) => Promise<AgyAccountUsageReading | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('agy failed'))
      .mockResolvedValue(reading('one@example.com', 0.1));
    const owner = ownerAt(paths, { probe, now: () => 9_000 });
    await owner.record(report('one@example.com', 0.9, 1_000));

    await expect(owner.refresh('default')).resolves.toBe(false);
    await expect(owner.refresh('default')).resolves.toBe(false);
    expect((await owner.read())[0]?.meters[0]?.remainingFraction).toBe(0.9);

    await expect(owner.refresh('default')).resolves.toBe(true);
    expect((await owner.read())[0]?.meters[0]?.remainingFraction).toBe(0.1);
  });

  it('does not lose saved accounts to a read that failed for now', async () => {
    const paths = await tempPaths();
    await mkdir(join(paths.accountsDir, 'b'), { recursive: true });
    const first = ownerAt(paths, { probe: async () => reading('b@example.com', 0.5), now: () => 2_000 });
    await first.refresh('b');
    const saved = await readFile(paths.storePath, 'utf8');
    await rm(paths.storePath);
    await mkdir(paths.storePath); // Reading it now fails with something other than "no file".

    const owner = ownerAt(paths);
    await expect(owner.read()).rejects.toThrow();
    await rm(paths.storePath, { recursive: true });
    await writeFile(paths.storePath, saved);

    await owner.record(report('one@example.com', 0.9, 3_000));
    expect((await owner.read()).map((account) => account.email)).toEqual(['one@example.com', 'b@example.com']);
  });

  it('starts empty from a damaged file, and can record again', async () => {
    const paths = await tempPaths();
    await writeFile(paths.storePath, 'not json');
    const owner = ownerAt(paths);
    expect((await owner.read()).map((account) => account.observedAtMs)).toEqual([null]);
    await owner.record(report('one@example.com', 0.9, 1_000));
    expect((await owner.read())[0]?.email).toBe('one@example.com');
  });
});
