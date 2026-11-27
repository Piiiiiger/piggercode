import type { AgyAccountUsageReportV1, AgyAccountUsageV1 } from '@piggercode/protocol';
import { describe, expect, it } from 'vitest';

import { createAgyAccountBroker, type AgyAccountBroker } from './agyAccountBroker';

const NOW = 1_800_000_000_000;
const H = 3_600_000;
const FRESHNESS = 300_000;

type MeterRow = readonly [meterId: string, remaining: number, resetAtMs: number | null];

function usage(accountId: string, meters: readonly MeterRow[], observedAtMs: number | null = NOW): AgyAccountUsageV1 {
  return {
    accountId,
    email: null,
    planTier: null,
    observedAtMs,
    meters: meters.map(([meterId, remainingFraction, resetAtMs]) => ({ meterId, remainingFraction, resetAtMs })),
  };
}

/** The machine: logins and their readings (the usage file), what a probe of agy would read, and the clock. */
function machine(initial: readonly AgyAccountUsageV1[], options: Readonly<{
  probeReads?: Readonly<Record<string, readonly MeterRow[] | null>>;
  namespace?: { ok: true } | { ok: false; reason: string };
  incomplete?: readonly string[];
}> = {}) {
  let clock = NOW;
  let readings = [...initial];
  const probed: string[] = [];
  const recorded: AgyAccountUsageReportV1[] = [];
  const counter = { n: 0 };
  const broker: AgyAccountBroker = createAgyAccountBroker({
    readUsage: async () => readings,
    recordUsage: async (report) => { recorded.push(report); },
    refreshUsage: async (accountId) => {
      probed.push(accountId);
      const read = options.probeReads?.[accountId];
      if (!read) return false;
      readings = readings.map((reading) => (reading.accountId === accountId ? usage(accountId, read, clock) : reading));
      return true;
    },
    listHomes: async () => readings.filter((reading) => reading.accountId !== 'default').map((reading) => ({
      accountId: reading.accountId,
      homeDir: `/logins/${reading.accountId}`,
    })),
    isLoginComplete: async (homeDir) => !(options.incomplete ?? []).some((id) => homeDir.endsWith(`/${id}`)),
    namespaceSupport: async () => options.namespace ?? { ok: true },
    quotaFreshnessMs: FRESHNESS,
    now: () => clock,
    newRequestId: () => `req-${(counter.n += 1)}`,
  });
  return {
    broker,
    probed,
    recorded,
    advance: (ms: number) => { clock += ms; },
    set: (next: readonly AgyAccountUsageV1[]) => { readings = [...next]; },
  };
}

const GEMINI_OK = (fiveHourReset: number | null, weeklyReset: number | null = NOW + 6 * 24 * H): MeterRow[] => [
  ['gemini-5h', 0.6, fiveHourReset],
  ['gemini-weekly', 0.6, weeklyReset],
];

const launch = (broker: AgyAccountBroker, modelId: string | null = null, runnerKey = 'runner-1') =>
  broker.chooseLaunchAccount({ runnerKey, modelId });

describe('agy login choice at launch (UA2)', () => {
  it('orders two healthy logins by the one whose 5 hour window resets first, not the weekly one', async () => {
    const { broker } = machine([
      // default: week resets first, 5 h window last. b: 5 h window resets first, week last.
      usage('default', GEMINI_OK(NOW + 4 * H, NOW + 1 * 24 * H)),
      usage('b', GEMINI_OK(NOW + 1 * H, NOW + 6 * 24 * H)),
    ]);
    expect(await launch(broker)).toMatchObject({ ok: true, accountId: 'b', accountHomeDir: '/logins/b' });
  });

  it('reads a stale login first and chooses by what it reads', async () => {
    const { broker, probed } = machine([
      usage('default', GEMINI_OK(NOW + 4 * H), NOW - 2 * FRESHNESS),
      usage('b', GEMINI_OK(NOW + 3 * H)),
    ], { probeReads: { default: GEMINI_OK(NOW + 1 * H) } });
    expect(await launch(broker)).toMatchObject({ accountId: 'default', accountHomeDir: null });
    expect(probed).toEqual(['default']);
  });

  it('reads a login whose window reset since it was last read, and does not read a login with a fresh reading', async () => {
    const { broker, probed, advance } = machine([
      usage('default', [['gemini-5h', 0, NOW + 10 * 60_000], ['gemini-weekly', 0.5, null]], NOW),
      usage('b', GEMINI_OK(NOW + 3 * H), NOW),
    ], { probeReads: { default: GEMINI_OK(null) } });
    advance(60_000);
    await launch(broker);
    expect(probed).toEqual([]);
    advance(10 * 60_000);
    // `b` was read 11 minutes ago, past the freshness limit, and `default`'s window has reset: both are read.
    await launch(broker, null, 'runner-2');
    expect([...probed].sort()).toEqual(['b', 'default']);
  });

  it('leaves out a login with less than 5 % in a window that matters while another has more', async () => {
    const { broker } = machine([
      usage('default', [['gemini-5h', 0.04, NOW + 1 * H], ['gemini-weekly', 0.9, NOW + 6 * 24 * H]]),
      usage('b', GEMINI_OK(NOW + 4 * H)),
    ]);
    expect(await launch(broker)).toMatchObject({ accountId: 'b' });
  });

  it('still picks a login that can run when all are under 5 %, the one with the most left', async () => {
    const { broker } = machine([
      usage('default', [['gemini-5h', 0.02, NOW + 1 * H], ['gemini-weekly', 0.9, null]]),
      usage('b', [['gemini-5h', 0.04, NOW + 1 * H], ['gemini-weekly', 0.9, null]]),
    ]);
    expect(await launch(broker)).toMatchObject({ accountId: 'b' });
  });

  it('chooses the login that recovers first when every login is out, and the default login when none says when', async () => {
    const out = (reset: number | null): MeterRow[] => [['gemini-5h', 0, reset], ['gemini-weekly', 0.5, null]];
    const soonest = machine([usage('default', out(NOW + 3 * H)), usage('b', out(NOW + 1 * H))]);
    expect(await launch(soonest.broker)).toMatchObject({ accountId: 'b' });
    const unknown = machine([usage('default', out(null)), usage('b', out(null))]);
    expect(await launch(unknown.broker)).toMatchObject({ accountId: 'default' });
  });

  it('decides by the model group: a login out of Gemini can still run a third-party model', async () => {
    const rows: MeterRow[] = [['gemini-5h', 0, NOW + 4 * H], ['gemini-weekly', 0.9, null], ['3p-5h', 0.9, NOW + 1 * H], ['3p-weekly', 0.9, null]];
    const { broker } = machine([usage('default', rows), usage('b', GEMINI_OK(NOW + 3 * H))]);
    expect(await launch(broker, 'gemini-4-neon-high')).toMatchObject({ accountId: 'b' });
    expect(await launch(broker, 'claude-opus-4-5', 'runner-2')).toMatchObject({ accountId: 'default' });
    // No model: agy's default model is a Gemini one.
    expect(await launch(broker, null, 'runner-3')).toMatchObject({ accountId: 'b' });
  });

  it('counts the Argon weekly limit for an Argon model only', async () => {
    const rows: MeterRow[] = [['gemini-5h', 0.9, NOW + 1 * H], ['gemini-weekly', 0.9, null], ['gemini-argon-wtu-weekly', 0, NOW + 2 * 24 * H]];
    const { broker } = machine([usage('default', rows), usage('b', GEMINI_OK(NOW + 4 * H))]);
    expect(await launch(broker, 'gemini-4-argon')).toMatchObject({ accountId: 'b' });
    expect(await launch(broker, 'gemini-4-neon-high', 'runner-2')).toMatchObject({ accountId: 'default' });
  });

  it('uses a login nothing is known of only when no login is known to be healthy', async () => {
    const withHealthy = machine([usage('default', [], null), usage('b', GEMINI_OK(NOW + 4 * H))]);
    expect(await launch(withHealthy.broker)).toMatchObject({ accountId: 'b' });
    const none = machine([usage('default', [], null), usage('b', [], null)]);
    expect((await launch(none.broker)).ok).toBe(true);
  });

  it('leaves a login out with its reason when the namespace cannot run, or its login never finished, and never says it is chosen', async () => {
    const noNamespace = machine(
      [usage('default', GEMINI_OK(NOW + 4 * H)), usage('b', GEMINI_OK(NOW + 1 * H))],
      { namespace: { ok: false, reason: 'unshare: Operation not permitted' } },
    );
    expect(await launch(noNamespace.broker)).toMatchObject({
      accountId: 'default',
      unavailable: [{ accountId: 'b', reason: 'namespace_unavailable' }],
    });
    const unfinished = machine(
      [usage('default', GEMINI_OK(NOW + 4 * H)), usage('b', GEMINI_OK(NOW + 1 * H))],
      { incomplete: ['b'] },
    );
    expect(await launch(unfinished.broker)).toMatchObject({ accountId: 'default', unavailable: [{ accountId: 'b', reason: 'login_incomplete' }] });
  });

  it('leaves out a login that needs signing in, with that reason, until agy reports limits for it again', async () => {
    const { broker, advance, set, probed } = machine([
      usage('default', GEMINI_OK(NOW + 4 * H)),
      usage('b', GEMINI_OK(NOW + 1 * H)),
      usage('c', GEMINI_OK(NOW + 5 * H)),
    ], { probeReads: { c: GEMINI_OK(NOW + 5 * H), default: GEMINI_OK(NOW + 4 * H) } });
    expect(await launch(broker)).toMatchObject({ accountId: 'b' });
    await broker.handleSession({ kind: 'login_unusable', runnerKey: 'runner-1', accountId: 'b', reason: 'needs_sign_in' });
    expect(await launch(broker, null, 'runner-2')).toMatchObject({
      accountId: 'default',
      unavailable: [{ accountId: 'b', reason: 'needs_sign_in' }],
    });
    // Not read on its own, however stale: it comes back through signing in (or the refresh button), which store a reading.
    advance(10 * 60_000);
    set([
      usage('default', GEMINI_OK(NOW + 4 * H), NOW + 10 * 60_000),
      usage('b', GEMINI_OK(NOW + 1 * H), NOW),
      usage('c', GEMINI_OK(NOW + 5 * H), NOW),
    ]);
    probed.length = 0;
    expect(await launch(broker, null, 'runner-3')).toMatchObject({ accountId: 'default', unavailable: [{ accountId: 'b', reason: 'needs_sign_in' }] });
    // The stale `c` is read (two usable logins), the stale `b` that needs signing in is not.
    expect(probed).toEqual(['c']);
    set([
      usage('default', GEMINI_OK(NOW + 4 * H), NOW + 10 * 60_000),
      usage('b', GEMINI_OK(NOW + 1 * H), NOW + 10 * 60_000),
      usage('c', GEMINI_OK(NOW + 5 * H), NOW + 10 * 60_000),
    ]);
    expect(await launch(broker, null, 'runner-4')).toMatchObject({ accountId: 'b', unavailable: [] });
  });

  it('never waits on a read when there is only one login to choose', async () => {
    const { broker, probed } = machine([usage('default', GEMINI_OK(NOW + 1 * H), null)], { probeReads: { default: GEMINI_OK(null) } });
    expect(await launch(broker)).toMatchObject({ accountId: 'default', accountHomeDir: null });
    const unread = machine([usage('default', [], null), usage('b', GEMINI_OK(NOW + 1 * H))], { namespace: { ok: false, reason: 'no userns' } });
    expect(await launch(unread.broker)).toMatchObject({ accountId: 'default' });
    expect(probed).toEqual([]);
    expect(unread.probed).toEqual([]);
  });

  it('does not let launches that are decided at the same moment all take the same login', async () => {
    const { broker } = machine([
      usage('default', [['gemini-5h', 0.08, NOW + 1 * H], ['gemini-weekly', 0.9, null]], NOW - 2 * FRESHNESS),
      usage('b', GEMINI_OK(NOW + 4 * H)),
    ], { probeReads: { default: [['gemini-5h', 0.08, NOW + 1 * H], ['gemini-weekly', 0.9, null]] } });
    const [first, second] = await Promise.all([launch(broker, null, 'runner-1'), launch(broker, null, 'runner-2')]);
    expect([first, second].map((choice) => (choice.ok ? choice.accountId : null)).sort()).toEqual(['b', 'default']);
  });

  it('keeps a launch\'s claim when another login reports for that runner', async () => {
    const { broker } = machine([
      usage('default', [['gemini-5h', 0.08, NOW + 1 * H], ['gemini-weekly', 0.9, null]]),
      usage('b', GEMINI_OK(NOW + 4 * H)),
    ]);
    expect(await launch(broker, null, 'runner-1')).toMatchObject({ accountId: 'default' });
    await broker.handleSession({ kind: 'signals', runnerKey: 'runner-1', accountId: 'b', childEpoch: 1, modelId: null, conversationId: null, limitHit: false });
    expect(await launch(broker, null, 'runner-2')).toMatchObject({ accountId: 'b' });
  });

  it('does not send launches that start together to the same login that is close to its floor', async () => {
    const { broker } = machine([
      // Soonest to reset, but only 8 % left: one launch's worth of margin.
      usage('default', [['gemini-5h', 0.08, NOW + 1 * H], ['gemini-weekly', 0.9, null]]),
      usage('b', GEMINI_OK(NOW + 4 * H)),
    ]);
    const first = await launch(broker, null, 'runner-1');
    const second = await launch(broker, null, 'runner-2');
    expect([first, second].map((choice) => (choice.ok ? choice.accountId : null))).toEqual(['default', 'b']);
  });

  it('does not read a login again before its backoff ends after a read that failed', async () => {
    const { broker, probed, advance } = machine([usage('default', GEMINI_OK(NOW + 1 * H), null), usage('b', GEMINI_OK(NOW + 3 * H))]);
    await launch(broker, null, 'runner-1');
    await launch(broker, null, 'runner-2');
    expect(probed).toEqual(['default']);
    advance(31_000);
    await launch(broker, null, 'runner-3');
    expect(probed).toEqual(['default', 'default']);
  });
});

function signals(over: Partial<{ accountId: string; childEpoch: number; modelId: string | null; limitHit: boolean; runnerKey: string }> = {}) {
  return {
    kind: 'signals' as const,
    runnerKey: 'runner-1',
    accountId: 'default',
    childEpoch: 1,
    modelId: null,
    conversationId: 'c1',
    limitHit: false,
    ...over,
  };
}

const decide = async (broker: AgyAccountBroker, over: Parameters<typeof signals>[0] = {}) => {
  const response = await broker.handleSession(signals(over));
  if (!response.ok) throw new Error(response.errorCode);
  return response.decision!;
};

describe('agy login switch decisions (UA3)', () => {
  const OUT: MeterRow[] = [['gemini-5h', 0, NOW + 2 * H], ['gemini-weekly', 0.5, null]];

  it('asks nothing while the login has room', async () => {
    const { broker } = machine([usage('default', GEMINI_OK(NOW + 1 * H)), usage('b', GEMINI_OK(NOW + 3 * H))]);
    expect(await decide(broker)).toEqual({ action: 'none' });
  });

  it('asks to move to the best other login when the group quota is exhausted', async () => {
    const { broker } = machine([usage('default', OUT), usage('b', GEMINI_OK(NOW + 3 * H))]);
    expect(await decide(broker)).toMatchObject({
      action: 'switch',
      request: { requestId: 'req-1', toAccountId: 'b', toAccountHomeDir: '/logins/b', reason: 'exhausted' },
      continuationPrompt: expect.stringMatching(/continue/i),
    });
  });

  it('keeps one request id while the target and reason stand, and a new one when they change', async () => {
    const { broker, set } = machine([usage('default', OUT), usage('b', GEMINI_OK(NOW + 3 * H)), usage('c', GEMINI_OK(NOW + 4 * H))]);
    const first = await decide(broker);
    const again = await decide(broker);
    expect(again.request?.requestId).toBe(first.request?.requestId);
    set([usage('default', OUT), usage('b', OUT), usage('c', GEMINI_OK(NOW + 4 * H))]);
    expect((await decide(broker)).request).toMatchObject({ toAccountId: 'c', requestId: 'req-2' });
  });

  it('treats agy\'s limit line as exhausted even while the numbers still look fine', async () => {
    const { broker } = machine([usage('default', GEMINI_OK(NOW + 1 * H)), usage('b', GEMINI_OK(NOW + 3 * H))]);
    expect(await decide(broker, { limitHit: true })).toMatchObject({ action: 'switch', request: { toAccountId: 'b', reason: 'exhausted' } });
  });

  it('keeps the limit line standing against the same numbers reported again, and lets different numbers outweigh it', async () => {
    const { broker, advance, set } = machine([usage('default', GEMINI_OK(NOW + 1 * H)), usage('b', GEMINI_OK(NOW + 3 * H))]);
    expect((await decide(broker, { limitHit: true })).action).toBe('switch');
    // The session reports the same numbers a minute later (its heartbeat): a newer time, nothing new.
    advance(60_000);
    set([usage('default', GEMINI_OK(NOW + 1 * H), NOW + 60_000), usage('b', GEMINI_OK(NOW + 3 * H), NOW + 60_000)]);
    expect((await decide(broker, { limitHit: true })).action).toBe('switch');
    // Different numbers after the line: the login has room again.
    advance(60_000);
    set([usage('default', [['gemini-5h', 0.9, NOW + 1 * H], ['gemini-weekly', 0.6, null]], NOW + 120_000), usage('b', GEMINI_OK(NOW + 3 * H), NOW + 120_000)]);
    expect((await decide(broker, { limitHit: true })).action).toBe('none');
  });

  it('moves early under 5 % only when another login has more, and says it is low', async () => {
    const low: MeterRow[] = [['gemini-5h', 0.03, NOW + 1 * H], ['gemini-weekly', 0.9, null]];
    const better = machine([usage('default', low), usage('b', GEMINI_OK(NOW + 3 * H))]);
    expect(await decide(better.broker)).toMatchObject({ action: 'switch', request: { toAccountId: 'b', reason: 'low' } });
    const alsoLow = machine([usage('default', low), usage('b', [['gemini-5h', 0.04, NOW + 1 * H], ['gemini-weekly', 0.9, null]])]);
    expect(await decide(alsoLow.broker)).toEqual({ action: 'none' });
  });

  it('stops asking once three switches happened in the hour, and asks again when the hour is over', async () => {
    const { broker, advance, set } = machine([usage('default', OUT), usage('b', GEMINI_OK(NOW + 3 * H))]);
    for (let n = 0; n < 3; n += 1) {
      // Each time the session is back on the exhausted login (a later process of the same runner).
      const decision = await decide(broker, { childEpoch: n + 1 });
      expect(decision.action).toBe('switch');
      await broker.handleSession({ kind: 'result', runnerKey: 'runner-1', requestId: decision.request!.requestId, outcome: 'switched' });
    }
    expect(await decide(broker, { childEpoch: 4 })).toEqual({ action: 'none' });
    advance(H + 1_000);
    set([usage('default', OUT, NOW + H + 1_000), usage('b', GEMINI_OK(NOW + 9 * H), NOW + H + 1_000)]);
    expect((await decide(broker, { childEpoch: 5 })).action).toBe('switch');
  });

  it('reports all exhausted with the earliest reset, and reads the logins after it with the quota backoff', async () => {
    const { broker, probed, advance } = machine(
      [usage('default', [['gemini-5h', 0, NOW + 3 * H], ['gemini-weekly', 0.5, null]]), usage('b', [['gemini-5h', 0, NOW + 1 * H], ['gemini-weekly', 0.5, null]])],
      { probeReads: { b: [['gemini-5h', 1, null], ['gemini-weekly', 0.5, null]] } },
    );
    expect(await decide(broker)).toEqual({ action: 'all_exhausted', earliestResetAtMs: NOW + 1 * H });
    expect(probed).toEqual([]);
    // Not yet at the reset (plus the clock margin): nothing is read.
    advance(1 * H);
    expect((await decide(broker)).action).toBe('all_exhausted');
    expect(probed).toEqual([]);
    // After it: the login whose window reset is read (`b` reads full), then the session moves to it.
    advance(31_000);
    expect(await decide(broker)).toMatchObject({ action: 'switch', request: { toAccountId: 'b', reason: 'exhausted' } });
    expect(probed).toContain('b');
  });

  it('does not read again before the backoff ends when a read at the reset fails', async () => {
    const out: MeterRow[] = [['gemini-5h', 0, NOW + 1 * H], ['gemini-weekly', 0.5, null]];
    const { broker, probed, advance } = machine([usage('default', out), usage('b', out)]);
    await decide(broker);
    advance(1 * H + 31_000);
    await decide(broker);
    const after = probed.length;
    expect(after).toBeGreaterThan(0);
    await decide(broker);
    expect(probed).toHaveLength(after);
    advance(31_000);
    await decide(broker);
    expect(probed.length).toBeGreaterThan(after);
  });

  it('keeps reading a login whose window reset but whose read still says it is out, once the reading is old', async () => {
    const out: MeterRow[] = [['gemini-5h', 0, NOW + 1 * H], ['gemini-weekly', 0.5, null]];
    const { broker, probed, advance } = machine(
      [usage('default', out), usage('b', GEMINI_OK(NOW + 9 * H))],
      { probeReads: { default: out } },
    );
    const own = () => probed.filter((id) => id === 'default').length;
    advance(1 * H + 31_000);
    await decide(broker);
    expect(own()).toBe(1);
    // The new reading still names the old reset: it expires with the freshness, and is read again.
    advance(FRESHNESS + 1_000);
    await decide(broker);
    expect(own()).toBeGreaterThan(1);
  });

  it('clears the banner and offers the continuation when the session\'s own login recovers first', async () => {
    const { broker, advance, set } = machine([usage('default', [['gemini-5h', 0, NOW + 1 * H], ['gemini-weekly', 0.5, null]])]);
    expect((await decide(broker)).action).toBe('all_exhausted');
    advance(1 * H + 31_000);
    set([usage('default', GEMINI_OK(null), NOW + 1 * H + 31_000)]);
    expect(await decide(broker)).toMatchObject({ action: 'recovered', continuationPrompt: expect.stringMatching(/continue/i) });
    expect(await decide(broker)).toEqual({ action: 'none' });
  });

  it('confirms a request while it still stands and refuses an old id, or one whose target ran out meanwhile', async () => {
    const { broker, set } = machine([usage('default', OUT), usage('b', GEMINI_OK(NOW + 3 * H))]);
    const request = (await decide(broker)).request!;
    expect(await broker.handleSession({ kind: 'confirm', runnerKey: 'runner-1', requestId: 'older' })).toEqual({ ok: true, valid: false });
    expect(await broker.handleSession({ kind: 'confirm', runnerKey: 'runner-1', requestId: request.requestId })).toEqual({ ok: true, valid: true });
    set([usage('default', OUT), usage('b', OUT)]);
    expect(await broker.handleSession({ kind: 'confirm', runnerKey: 'runner-1', requestId: request.requestId })).toEqual({ ok: true, valid: false });
  });

  it('keeps a login that failed to start out of the choice for the cooldown', async () => {
    const { broker, advance } = machine([usage('default', OUT), usage('b', GEMINI_OK(NOW + 3 * H)), usage('c', GEMINI_OK(NOW + 4 * H))]);
    const request = (await decide(broker)).request!;
    expect(request.toAccountId).toBe('b');
    await broker.handleSession({ kind: 'result', runnerKey: 'runner-1', requestId: request.requestId, outcome: 'target_failed' });
    expect((await decide(broker)).request?.toAccountId).toBe('c');
    advance(31_000);
    expect((await decide(broker)).request?.toAccountId).toBe('b');
  });

  it('ignores signals from an agy process older than the newest one of that runner', async () => {
    const { broker } = machine([usage('default', OUT), usage('b', GEMINI_OK(NOW + 3 * H))]);
    await decide(broker, { accountId: 'b', childEpoch: 2 });
    expect(await decide(broker, { accountId: 'default', childEpoch: 1 })).toEqual({ action: 'none' });
  });
});

describe('no timed reads of an idle session', () => {
  it('reads nothing on a heartbeat of a healthy session past the freshness limit', async () => {
    const { broker, probed, advance } = machine([usage('default', GEMINI_OK(NOW + 1 * H)), usage('b', GEMINI_OK(NOW + 3 * H))]);
    await decide(broker);
    advance(FRESHNESS * 3);
    expect((await decide(broker, { childEpoch: 1 })).action).toBe('none');
    advance(FRESHNESS * 3);
    await decide(broker);
    expect(probed).toEqual([]);
  });

  it('never reads on a machine with a single login, even after a limit line', async () => {
    const { broker, probed } = machine([usage('default', [['gemini-5h', 0, NOW + 1 * H], ['gemini-weekly', 0.5, null]])]);
    await decide(broker, { limitHit: true });
    expect(probed).toEqual([]);
  });

  it('reads the own login to confirm a limit when there is another login to move to', async () => {
    const { broker, probed } = machine([usage('default', GEMINI_OK(NOW + 1 * H)), usage('b', GEMINI_OK(NOW + 3 * H))]);
    await decide(broker, { limitHit: true });
    expect(probed).toContain('default');
  });
});

describe('agy usage attribution', () => {
  const report = (over: Partial<AgyAccountUsageReportV1>): AgyAccountUsageReportV1 => ({
    email: null,
    planTier: null,
    observedAtMs: NOW,
    meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: null }],
    ...over,
  });

  it('files what a process reports under its login and drops a late report from a replaced process', async () => {
    const { broker, recorded } = machine([usage('default', GEMINI_OK(null))]);
    await broker.handleSession({ kind: 'signals', runnerKey: 'k', accountId: 'b', childEpoch: 2, modelId: null, conversationId: null, limitHit: false });
    await broker.recordUsage(report({ accountId: 'b', runnerKey: 'k', childEpoch: 2 }));
    // The process before the switch reports late.
    await broker.recordUsage(report({ accountId: 'default', runnerKey: 'k', childEpoch: 1 }));
    await broker.recordUsage(report({ accountId: 'b', runnerKey: 'k', childEpoch: 2, observedAtMs: NOW + 1 }));
    expect(recorded.map((entry) => [entry.accountId, entry.childEpoch])).toEqual([['b', 2], ['b', 2]]);
  });

  it('files a report from an older CLI, which names no login, as it is', async () => {
    const { broker, recorded } = machine([usage('default', GEMINI_OK(null))]);
    await broker.recordUsage(report({}));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.accountId).toBeUndefined();
  });
});

