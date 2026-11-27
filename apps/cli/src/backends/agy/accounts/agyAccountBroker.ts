import { randomUUID } from 'node:crypto';

import {
  AGY_DEFAULT_ACCOUNT_ID,
  resolveAgyMeterWindowMs,
  resolveAgyRelevantMeterIds,
  type AgyAccountDecisionV1,
  type AgyAccountSessionRequestV1,
  type AgyAccountSessionResponseV1,
  type AgyAccountUsageMeterV1,
  type AgyAccountUsageReportV1,
  type AgyAccountUsageV1,
  type AgyLaunchAccountRequestV1,
  type AgyLaunchAccountResponseV1,
  type AgyLoginUnavailableReason,
} from '@piggercode/protocol';

import {
  DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1,
  selectConnectedServiceAuthGroupCandidate,
  type ConnectedServiceAuthGroupMemberRuntimeState,
  type ConnectedServiceAuthGroupPolicyV1,
} from '@/daemon/connectedServices/accountGroups/selection/selectConnectedServiceAuthGroupCandidate';
import { buildContinuationResumePrompt } from '@/daemon/connectedServices/continuation/continuationResumePrompt';
import { logger } from '@/ui/logger';

import type { AgyAccountHome } from './agyAccountUsageOwner';
import type { AgyNamespaceSupport } from './agyAccountNamespace';

/** D2: a login with less than this left in a window that matters is not picked while another one has more. */
export const AGY_QUOTA_FLOOR_PERCENT = 5;

/** A reset is read a little after its time, so a clock that runs behind does not read a window that has not reset yet. */
const RESET_READ_MARGIN_MS = 30_000;

/** The existing quota-fetch backoff (D8): a failed read of a login waits 30 s, doubling up to 10 min. */
const PROBE_BACKOFF_BASE_MS = 30_000;
const PROBE_BACKOFF_MAX_MS = 10 * 60_000;

const HOUR_MS = 3_600_000;

/** The policy agy logins are chosen by: `expiry_first` with the 5 % floor, everything else the pool default. */
export const AGY_ACCOUNT_POLICY: ConnectedServiceAuthGroupPolicyV1 = {
  ...DEFAULT_CONNECTED_SERVICE_AUTH_GROUP_POLICY_V1,
  strategy: 'expiry_first',
  softSwitchRemainingPercent: AGY_QUOTA_FLOOR_PERCENT,
};

type Login = Readonly<{ accountId: string; homeDir: string | null; unavailable: AgyLoginUnavailableReason | null }>;

type PendingSwitch = Readonly<{
  requestId: string;
  toAccountId: string;
  reason: 'exhausted' | 'low';
}>;

type SessionRecord = {
  accountId: string | null;
  childEpoch: number;
  modelId: string | null;
  /** When the runner's limit line was first seen with no later reading of the login's own quota yet. */
  limitHitSinceMs: number | null;
  /** The login's relevant numbers when the limit line was first judged: only different ones, or a read of agy, outweigh it. */
  hitMetersKey: string | null;
  switchTimes: number[];
  pending: PendingSwitch | null;
  allExhausted: boolean;
  /** What the banner said last for all exhausted, kept while a read of the logins is still to come. */
  earliestResetAtMs: number | null;
};

export type AgyAccountBroker = Readonly<{
  /** A new session asks which login to start agy on. */
  chooseLaunchAccount: (request: AgyLaunchAccountRequestV1) => Promise<AgyLaunchAccountResponseV1>;
  /** What a running session's runner tells and asks. */
  handleSession: (request: AgyAccountSessionRequestV1) => Promise<AgyAccountSessionResponseV1>;
  /** A running agy's usage report: filed under the login it runs on, unless a newer process of that runner reported. */
  recordUsage: (report: AgyAccountUsageReportV1) => Promise<void>;
}>;

/**
 * The only decider of which agy login a session runs on, at launch and while it runs (plan r19, I1): ranks the
 * machine's logins with the pool's `selectConnectedServiceAuthGroupCandidate` (`expiry_first`, ordered by the
 * 5-hour window), for the model group of the session. The logins are synthetic pool members and their agy
 * readings quota snapshots. It reads stale logins first (single-flight, with the existing backoff), counts
 * launches that have not reported yet against their login, and keeps each running session's pending switch,
 * hourly count and cooldowns. It starts nothing itself: the runner executes what it decides, when it is safe.
 */
export function createAgyAccountBroker(params: Readonly<{
  readUsage: () => Promise<readonly AgyAccountUsageV1[]>;
  recordUsage: (report: AgyAccountUsageReportV1) => Promise<void>;
  /** Starts agy once on a login to read its limits; true when it reported them. */
  refreshUsage: (accountId: string) => Promise<boolean>;
  listHomes: () => Promise<readonly AgyAccountHome[]>;
  isLoginComplete: (homeDir: string) => Promise<boolean>;
  namespaceSupport: () => Promise<AgyNamespaceSupport>;
  /** How old a reading may be and still stand for the login (the pool's quota freshness). */
  quotaFreshnessMs: number;
  now?: () => number;
  newRequestId?: () => string;
  policy?: ConnectedServiceAuthGroupPolicyV1;
}>): AgyAccountBroker {
  const now = params.now ?? Date.now;
  const newRequestId = params.newRequestId ?? randomUUID;
  const policy = params.policy ?? AGY_ACCOUNT_POLICY;
  const sessions = new Map<string, SessionRecord>();
  /** Launches that chose a login and have not reported from it yet. */
  const claims = new Map<string, Readonly<{ accountId: string; atMs: number }>>();
  const cooldownStartedAtMs = new Map<string, number>();
  /** Logins whose agy showed its sign-in screen, and when: left out until a reading taken after that is stored. */
  const needsSignIn = new Map<string, number>();
  /** When agy last reported a login's limits to a read of ours (not a session's own report). */
  const probedAt = new Map<string, number>();
  const probeBackoff = new Map<string, Readonly<{ failures: number; nextAtMs: number }>>();

  /** A launch's claim ends when its session reports from the login it claimed, not from another one. */
  const releaseClaim = (runnerKey: string, accountId: string): void => {
    if (claims.get(runnerKey)?.accountId === accountId) claims.delete(runnerKey);
  };

  const session = (runnerKey: string): SessionRecord => {
    let record = sessions.get(runnerKey);
    if (!record) {
      record = {
        accountId: null, childEpoch: 0, modelId: null, limitHitSinceMs: null, hitMetersKey: null, switchTimes: [], pending: null, allExhausted: false, earliestResetAtMs: null,
      };
      sessions.set(runnerKey, record);
    }
    return record;
  };

  const resolveLogins = async (): Promise<readonly Login[]> => {
    const readings = await params.readUsage();
    const homes = new Map((await params.listHomes()).map((home) => [home.accountId, home.homeDir]));
    const added = readings.filter((reading) => reading.accountId !== AGY_DEFAULT_ACCOUNT_ID);
    const namespace = added.length > 0 ? await params.namespaceSupport() : null;
    return await Promise.all(readings.map(async (reading): Promise<Login> => {
      if (reading.accountId === AGY_DEFAULT_ACCOUNT_ID) return { accountId: reading.accountId, homeDir: null, unavailable: null };
      const homeDir = homes.get(reading.accountId) ?? null;
      if (!homeDir) return { accountId: reading.accountId, homeDir, unavailable: 'login_incomplete' };
      const markedAt = needsSignIn.get(reading.accountId);
      if (markedAt !== undefined) {
        if (reading.observedAtMs === null || reading.observedAtMs <= markedAt) {
          return { accountId: reading.accountId, homeDir, unavailable: 'needs_sign_in' };
        }
        // Read again since: agy reported limits for it, so it is signed in.
        needsSignIn.delete(reading.accountId);
      }
      if (namespace && !namespace.ok) {
        logger.infoFile('[agy-accounts] A login cannot be used: the namespace is unavailable', { accountId: reading.accountId, reason: namespace.reason });
        return { accountId: reading.accountId, homeDir, unavailable: 'namespace_unavailable' };
      }
      return { accountId: reading.accountId, homeDir, unavailable: (await params.isLoginComplete(homeDir)) ? null : 'login_incomplete' };
    }));
  };

  const relevantMeters = (reading: AgyAccountUsageV1, modelId: string | null): AgyAccountUsageMeterV1[] => {
    const ids = new Set(resolveAgyRelevantMeterIds(modelId));
    return reading.meters.filter((meter) => ids.has(meter.meterId));
  };

  /**
   * A reading stands for its login while it is recent and no relevant window has reset since it was taken. An
   * exhausted window cannot recover before its reset, so a login out of quota keeps its reading until then.
   */
  const isStale = (reading: AgyAccountUsageV1, modelId: string | null): boolean => {
    const observedAtMs = reading.observedAtMs;
    if (observedAtMs === null) return true;
    const at = now();
    if (observedAtMs > at) return true;
    const meters = relevantMeters(reading, modelId);
    if (meters.some((meter) => meter.resetAtMs !== null && meter.resetAtMs > observedAtMs && meter.resetAtMs + RESET_READ_MARGIN_MS <= at)) {
      return true;
    }
    const outUntilReset = meters.some((meter) => (
      meter.remainingFraction <= 0 && meter.resetAtMs !== null && meter.resetAtMs + RESET_READ_MARGIN_MS > at
    ));
    return !outUntilReset && at - observedAtMs >= params.quotaFreshnessMs;
  };

  /** Reads a login with agy, once at a time per login, and not again until its backoff ends. */
  const probe = async (accountId: string): Promise<void> => {
    const backoff = probeBackoff.get(accountId);
    if (backoff && now() < backoff.nextAtMs) return;
    const read = await params.refreshUsage(accountId);
    if (read) {
      probedAt.set(accountId, now());
      probeBackoff.delete(accountId);
      return;
    }
    const failures = (backoff?.failures ?? 0) + 1;
    probeBackoff.set(accountId, {
      failures,
      nextAtMs: now() + Math.min(PROBE_BACKOFF_BASE_MS * 2 ** (failures - 1), PROBE_BACKOFF_MAX_MS),
    });
  };

  const readFresh = async (modelId: string | null, accountIds: readonly string[]): Promise<readonly AgyAccountUsageV1[]> => {
    const readings = await params.readUsage();
    const stale = readings.filter((reading) => accountIds.includes(reading.accountId) && isStale(reading, modelId));
    if (stale.length === 0) return readings;
    await Promise.all(stale.map((reading) => probe(reading.accountId)));
    return await params.readUsage();
  };

  const claimsOn = (accountId: string, exceptRunnerKey?: string): number => {
    let count = 0;
    for (const [runnerKey, claim] of claims) {
      if (now() - claim.atMs >= params.quotaFreshnessMs) {
        claims.delete(runnerKey);
      } else if (claim.accountId === accountId && runnerKey !== exceptRunnerKey) {
        count += 1;
      }
    }
    return count;
  };

  /** The login's reading as a pool quota snapshot for the session's model group; null when nothing of it is known. */
  const toMemberState = (
    reading: AgyAccountUsageV1,
    modelId: string | null,
    claimed: number,
  ): ConnectedServiceAuthGroupMemberRuntimeState => {
    const meters = isStale(reading, modelId) ? [] : relevantMeters(reading, modelId);
    if (meters.length === 0) return {};
    // Each launch still on its way to this login is assumed to use up to the floor.
    const snapshots = meters.map((meter) => {
      const remainingPct = meter.remainingFraction * 100;
      return {
        meterId: meter.meterId,
        limitCategory: 'usage_limit' as const,
        remainingPct: remainingPct > 0 ? Math.max(remainingPct - claimed * AGY_QUOTA_FLOOR_PERCENT, 0.01) : 0,
        resetAtMs: meter.resetAtMs,
        providerLimitId: null,
        windowDurationMs: resolveAgyMeterWindowMs(meter.meterId),
      };
    });
    const lowest = snapshots.reduce((a, b) => (b.remainingPct < a.remainingPct ? b : a));
    return {
      quotaSnapshot: {
        // Staleness was decided above, by this owner: the pool's own freshness check must not second-guess it.
        capturedAtMs: now(),
        effectiveMeterId: lowest.meterId,
        effectiveRemainingPercent: lowest.remainingPct,
        meters: snapshots,
        exhausted: lowest.remainingPct <= 0,
      },
    };
  };

  type Ranking = Readonly<{
    selected: Readonly<{ accountId: string; remainingPercent: number | null }> | null;
    logins: readonly Login[];
    readings: readonly AgyAccountUsageV1[];
  }>;

  const rank = async (input: Readonly<{
    modelId: string | null;
    currentAccountId: string | null;
    exceptRunnerKey?: string;
    probeStale: boolean;
    /** Counts the chosen login against this runner in the same step as the choice, so no other choice sees it unclaimed. */
    claimFor?: string;
  }>): Promise<Ranking> => {
    const logins = await resolveLogins();
    // A login that needs signing in is never read on its own: it returns through signing in or the refresh button.
    const usable = logins.filter((login) => login.unavailable === null);
    // With one login to choose from, nothing a read could show changes the choice, so nothing waits for one.
    const readings = input.probeStale && usable.length > 1
      ? await readFresh(input.modelId, usable.map((login) => login.accountId))
      : await params.readUsage();
    // From here to the claim there is no wait.
    const members = usable.map((login, index) => ({ profileId: login.accountId, priority: index, createdAtMs: 0, enabled: true }));
    const states = new Map(readings
      .filter((reading) => usable.some((login) => login.accountId === reading.accountId))
      .map((reading) => [reading.accountId, toMemberState(reading, input.modelId, claimsOn(reading.accountId, input.exceptRunnerKey))]));
    const selection = selectConnectedServiceAuthGroupCandidate({
      nowMs: now(),
      quotaFreshnessMs: params.quotaFreshnessMs,
      activeProfileId: input.currentAccountId,
      policy,
      members,
      memberStatesByProfileId: states,
      preferenceWindow: 'shortest',
      // A login that failed to start rests for the pool's cooldown (kept out here: fresh quota evidence would clear
      // a cooldown in the member state).
      unavailableProfileIds: new Set([...cooldownStartedAtMs].filter(([, at]) => now() - at < policy.cooldownMs).map(([id]) => id)),
    });
    const selected = selection.selected;
    if (selected && input.claimFor) claims.set(input.claimFor, { accountId: selected.profileId, atMs: now() });
    return {
      selected: selected ? { accountId: selected.profileId, remainingPercent: selected.leastLimitedScore } : null,
      logins,
      readings,
    };
  };

  /** When each login could run the model again: the last reset among its exhausted windows (a login with no known reset is left out). */
  const recoveries = (
    logins: readonly Login[],
    readings: readonly AgyAccountUsageV1[],
    modelId: string | null,
  ): ReadonlyArray<Readonly<{ accountId: string; atMs: number }>> => readings.flatMap((reading) => {
    if (logins.some((login) => login.accountId === reading.accountId && login.unavailable !== null)) return [];
    const exhausted = relevantMeters(reading, modelId).filter((meter) => meter.remainingFraction <= 0);
    if (exhausted.length === 0 || exhausted.some((meter) => meter.resetAtMs === null)) return [];
    return [{ accountId: reading.accountId, atMs: Math.max(...exhausted.map((meter) => meter.resetAtMs ?? 0)) }];
  });

  const earliest = (found: ReturnType<typeof recoveries>): Readonly<{ accountId: string; atMs: number }> | null => (
    found.length === 0 ? null : found.reduce((a, b) => (b.atMs < a.atMs ? b : a))
  );

  const chooseLaunchAccount = async (request: AgyLaunchAccountRequestV1): Promise<AgyLaunchAccountResponseV1> => {
    const ranking = await rank({
      modelId: request.modelId,
      currentAccountId: null,
      exceptRunnerKey: request.runnerKey,
      probeStale: true,
      claimFor: request.runnerKey,
    });
    const unavailable = ranking.logins
      .filter((login) => login.unavailable !== null)
      .map((login) => ({ accountId: login.accountId, reason: login.unavailable! }));
    // Nothing can run the model right now: the login that recovers first (a session there waits at agy's limit
    // screen and the banner says when), else the default login.
    const accountId = ranking.selected?.accountId
      ?? earliest(recoveries(ranking.logins, ranking.readings, request.modelId))?.accountId
      ?? AGY_DEFAULT_ACCOUNT_ID;
    claims.set(request.runnerKey, { accountId, atMs: now() });
    return {
      ok: true,
      accountId,
      accountHomeDir: ranking.logins.find((login) => login.accountId === accountId)?.homeDir ?? null,
      unavailable,
    };
  };

  type Assessment = Readonly<{
    /** `unknown`: the login's quota for the model is not known (no reading yet, or one that could not be renewed). */
    status: 'ok' | 'low' | 'exhausted' | 'unknown';
    ranking: Ranking | null;
    target: Readonly<{ accountId: string; homeDir: string | null }> | null;
  }>;

  /** How the session's login stands and, when it should leave it, where to. */
  const assess = async (
    record: SessionRecord,
    input: Readonly<{ limitHit: boolean; probeStale: boolean; claimFor?: string }>,
  ): Promise<Assessment> => {
    const accountId = record.accountId ?? AGY_DEFAULT_ACCOUNT_ID;
    let readings = await params.readUsage();
    let reading = readings.find((candidate) => candidate.accountId === accountId) ?? null;
    // The session's own login is read with agy only to confirm a limit (the line, or a window at 0) or to find
    // out when a used-up login recovered: never because an idle session's reading got old (no timed starts, D8),
    // and never on a machine with a single login, where no read could change what happens.
    const confirmsLimit = input.limitHit || record.allExhausted
      || (reading !== null && relevantMeters(reading, record.modelId).some((meter) => meter.remainingFraction <= 0));
    if (input.probeStale && confirmsLimit && reading !== null
      && (await resolveLogins()).filter((login) => login.unavailable === null).length > 1) {
      // A limit line is confirmed by one read of agy after it, whatever the age of the stored reading.
      if (input.limitHit && (probedAt.get(accountId) ?? 0) <= (record.limitHitSinceMs ?? 0)) await probe(accountId);
      readings = await readFresh(record.modelId, [accountId]);
      reading = readings.find((candidate) => candidate.accountId === accountId) ?? null;
    }
    const meters = reading && !isStale(reading, record.modelId) ? relevantMeters(reading, record.modelId) : [];
    // The limit line counts as exhausted until the login's quota shows room again: in a read of agy made after the
    // line, or in different numbers. A session repeating the same numbers every minute proves nothing.
    const metersKey = JSON.stringify(meters.map((meter) => [meter.meterId, meter.remainingFraction, meter.resetAtMs]));
    if (input.limitHit && record.hitMetersKey === null && meters.length > 0) record.hitMetersKey = metersKey;
    const since = record.limitHitSinceMs;
    const readAfterHit = since !== null && (
      (probedAt.get(accountId) ?? 0) > since || (record.hitMetersKey !== null && metersKey !== record.hitMetersKey)
    ) && reading?.observedAtMs != null && reading.observedAtMs > since;
    const hitStands = input.limitHit && !(readAfterHit && meters.length > 0 && meters.every((meter) => meter.remainingFraction > 0));
    const exhausted = hitStands || meters.some((meter) => meter.remainingFraction <= 0);
    const low = !exhausted && meters.some((meter) => meter.remainingFraction * 100 < AGY_QUOTA_FLOOR_PERCENT);
    if (!exhausted && meters.length === 0) return { status: 'unknown', ranking: null, target: null };
    if (!exhausted && !low) return { status: 'ok', ranking: null, target: null };
    if (record.switchTimes.filter((at) => now() - at < HOUR_MS).length >= policy.maxSwitchesPerSessionHour) {
      return { status: exhausted ? 'exhausted' : 'low', ranking: null, target: null };
    }
    const ranking = await rank({
      modelId: record.modelId,
      currentAccountId: accountId,
      probeStale: input.probeStale,
      ...(input.claimFor ? { claimFor: input.claimFor } : {}),
    });
    const adequate = ranking.selected !== null
      && (exhausted || (ranking.selected.remainingPercent !== null && ranking.selected.remainingPercent > AGY_QUOTA_FLOOR_PERCENT));
    const login = adequate ? ranking.logins.find((candidate) => candidate.accountId === ranking.selected!.accountId) : null;
    return {
      status: exhausted ? 'exhausted' : 'low',
      ranking,
      target: login ? { accountId: login.accountId, homeDir: login.homeDir } : null,
    };
  };

  const handleSignals = async (request: Extract<AgyAccountSessionRequestV1, { kind: 'signals' }>): Promise<AgyAccountDecisionV1> => {
    const record = session(request.runnerKey);
    if (request.childEpoch < record.childEpoch) return { action: 'none' };
    record.childEpoch = request.childEpoch;
    record.accountId = request.accountId;
    record.modelId = request.modelId;
    releaseClaim(request.runnerKey, request.accountId);
    if (request.limitHit) record.limitHitSinceMs ??= now();
    else {
      record.limitHitSinceMs = null;
      record.hitMetersKey = null;
    }

    const assessment = await assess(record, { limitHit: request.limitHit, probeStale: true });
    if (assessment.status === 'unknown') {
      // Nothing new is known: what was said stays said.
      return record.allExhausted ? { action: 'all_exhausted', earliestResetAtMs: record.earliestResetAtMs } : { action: 'none' };
    }
    if (assessment.status === 'ok') {
      record.pending = null;
      if (!record.allExhausted) return { action: 'none' };
      record.allExhausted = false;
      record.earliestResetAtMs = null;
      return {
        action: 'recovered',
        continuationPrompt: buildContinuationResumePrompt({ resumePromptMode: 'standard', recoveryKind: 'usage_limit' }),
      };
    }
    if (assessment.target) {
      record.allExhausted = false;
      record.earliestResetAtMs = null;
      const reason = assessment.status === 'exhausted' ? 'exhausted' : 'low';
      // The same request while its target and reason stand, so a runner that waits keeps one id to confirm.
      const pending: PendingSwitch = record.pending?.toAccountId === assessment.target.accountId && record.pending.reason === reason
        ? record.pending
        : { requestId: newRequestId(), toAccountId: assessment.target.accountId, reason };
      record.pending = pending;
      return {
        action: 'switch',
        request: {
          requestId: pending.requestId,
          toAccountId: pending.toAccountId,
          toAccountHomeDir: assessment.target.homeDir,
          reason,
        },
        continuationPrompt: buildContinuationResumePrompt({ resumePromptMode: 'standard', recoveryKind: 'usage_limit' }),
      };
    }
    record.pending = null;
    if (assessment.status === 'exhausted' && assessment.ranking) {
      record.allExhausted = true;
      record.earliestResetAtMs = earliest(recoveries(assessment.ranking.logins, assessment.ranking.readings, record.modelId))?.atMs
        ?? record.earliestResetAtMs;
      return { action: 'all_exhausted', earliestResetAtMs: record.earliestResetAtMs };
    }
    return { action: 'none' };
  };

  const handleConfirm = async (runnerKey: string, requestId: string): Promise<boolean> => {
    const record = sessions.get(runnerKey);
    const pending = record?.pending;
    if (!record || !pending || pending.requestId !== requestId) return false;
    // Decided again from what is known now (no new reads): the source may have recovered, or the target run out.
    const assessment = await assess(record, { limitHit: record.limitHitSinceMs !== null, probeStale: false, claimFor: runnerKey });
    if (assessment.target?.accountId !== pending.toAccountId) {
      record.pending = null;
      claims.delete(runnerKey);
      return false;
    }
    return true;
  };

  const handleResult = (request: Extract<AgyAccountSessionRequestV1, { kind: 'result' }>): void => {
    const record = sessions.get(request.runnerKey);
    if (!record) return;
    const pending = record.pending;
    if (pending?.requestId === request.requestId) {
      if (request.outcome === 'switched') {
        record.switchTimes = [...record.switchTimes.filter((at) => now() - at < HOUR_MS), now()];
        record.accountId = pending.toAccountId;
      } else if (request.outcome === 'target_failed') {
        cooldownStartedAtMs.set(pending.toAccountId, now());
      }
      record.pending = null;
    }
    if (request.outcome !== 'switched') claims.delete(request.runnerKey);
  };

  return {
    chooseLaunchAccount,
    recordUsage: async (report) => {
      if (report.runnerKey && report.childEpoch) {
        // Only a runner the daemon already heard from has an epoch to compare: a report after `ended` starts nothing.
        const record = sessions.get(report.runnerKey);
        if (!record) {
          await params.recordUsage(report);
          return;
        }
        // A late reading from an agy process that was replaced: dropped, so it never lands after a newer one.
        if (report.childEpoch < record.childEpoch) return;
        record.childEpoch = report.childEpoch;
        if (report.accountId) releaseClaim(report.runnerKey, report.accountId);
      }
      await params.recordUsage(report);
    },
    handleSession: async (request) => {
      switch (request.kind) {
        case 'signals':
          return { ok: true, decision: await handleSignals(request) };
        case 'confirm':
          return { ok: true, valid: await handleConfirm(request.runnerKey, request.requestId) };
        case 'result':
          handleResult(request);
          return { ok: true };
        case 'login_unusable':
          needsSignIn.set(request.accountId, now());
          return { ok: true };
        case 'ended':
          sessions.delete(request.runnerKey);
          claims.delete(request.runnerKey);
          return { ok: true };
      }
    },
  };
}
