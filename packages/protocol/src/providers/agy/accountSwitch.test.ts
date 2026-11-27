import { describe, expect, it } from 'vitest';

import {
  AgyAccountDecisionV1Schema,
  AgyAccountSessionRequestV1Schema,
  AgyAccountSwitchConfirmResponseV1Schema,
  AgyAccountSwitchStateV1Schema,
} from './accountSwitch';
import { AgyAccountUsageReportV1Schema, resolveAgyModelGroup, resolveAgyRelevantMeterIds } from './accountUsage';

describe('AgyAccountSwitchStateV1Schema', () => {
  it('reads every state the app shows, and ignores fields a newer CLI adds', () => {
    const parsed = AgyAccountSwitchStateV1Schema.parse({
      v: 1,
      state: 'all_exhausted',
      fromAccountId: 'default',
      earliestResetAtMs: null,
      sudoUnavailable: true,
      updatedAtMs: 5,
      somethingNew: 'x',
    });
    expect(parsed).toEqual({
      v: 1,
      state: 'all_exhausted',
      fromAccountId: 'default',
      earliestResetAtMs: null,
      sudoUnavailable: true,
      updatedAtMs: 5,
    });
  });

  it('rejects a state or a version it does not know', () => {
    expect(AgyAccountSwitchStateV1Schema.safeParse({ v: 1, state: 'later', updatedAtMs: 1 }).success).toBe(false);
    expect(AgyAccountSwitchStateV1Schema.safeParse({ v: 2, state: 'none', updatedAtMs: 1 }).success).toBe(false);
  });

  it('answers the confirm RPC with ok or one of the three refusals', () => {
    expect(AgyAccountSwitchConfirmResponseV1Schema.safeParse({ ok: true }).success).toBe(true);
    expect(AgyAccountSwitchConfirmResponseV1Schema.safeParse({ ok: false, reason: 'stale_request' }).success).toBe(true);
    expect(AgyAccountSwitchConfirmResponseV1Schema.safeParse({ ok: false, reason: 'whatever' }).success).toBe(false);
  });
});

describe('agy session decisions and reports', () => {
  it('reads a decision with a switch request and tolerates unknown fields', () => {
    const decision = AgyAccountDecisionV1Schema.parse({
      action: 'switch',
      request: { requestId: 'r1', toAccountId: 'b', toAccountHomeDir: '/x/b', reason: 'exhausted', extra: 1 },
      future: true,
    });
    expect(decision.request?.toAccountId).toBe('b');
  });

  it('needs a kind on what a runner sends', () => {
    expect(AgyAccountSessionRequestV1Schema.safeParse({ runnerKey: 'k' }).success).toBe(false);
    expect(AgyAccountSessionRequestV1Schema.safeParse({ kind: 'ended', runnerKey: 'k' }).success).toBe(true);
  });

  it('keeps accepting a usage report from a CLI that names no login', () => {
    const report = { email: null, planTier: null, observedAtMs: 1, meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: null }] };
    expect(AgyAccountUsageReportV1Schema.parse(report).accountId).toBeUndefined();
    expect(AgyAccountUsageReportV1Schema.parse({ ...report, accountId: 'b', runnerKey: 'k', childEpoch: 2 }).childEpoch).toBe(2);
  });
});

describe('agy model groups', () => {
  it('puts a session without a model, and every Gemini model, in the Gemini group', () => {
    expect(resolveAgyModelGroup(null)).toBe('gemini');
    expect(resolveAgyModelGroup('default')).toBe('gemini');
    expect(resolveAgyModelGroup('gemini-4-neon-high')).toBe('gemini');
    expect(resolveAgyModelGroup('gemini-4-orchestrator')).toBe('gemini');
  });

  it('puts Claude and GPT-OSS models in the third-party group', () => {
    expect(resolveAgyModelGroup('claude-opus-4-5')).toBe('third_party');
    expect(resolveAgyModelGroup('gpt-oss-120b')).toBe('third_party');
  });

  it('counts the Argon weekly limit only for an Argon model', () => {
    expect(resolveAgyRelevantMeterIds('gemini-4-neon-high')).toEqual(['gemini-5h', 'gemini-weekly']);
    expect(resolveAgyRelevantMeterIds('gemini-4-argon')).toEqual(['gemini-5h', 'gemini-weekly', 'gemini-argon-wtu-weekly']);
    expect(resolveAgyRelevantMeterIds('claude-sonnet-5-5')).toEqual(['3p-5h', '3p-weekly']);
  });
});
