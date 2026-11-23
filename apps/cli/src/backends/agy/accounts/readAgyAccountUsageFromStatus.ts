import type { AgyAccountUsageMeterV1 } from '@piggercode/protocol';

/** The limits the app shows, in the order agy's `/usage` groups them. */
const AGY_ACCOUNT_USAGE_METER_IDS = ['gemini-5h', 'gemini-weekly', '3p-5h', '3p-weekly'];

export type AgyAccountUsageReading = Readonly<{
  email: string | null;
  planTier: string | null;
  meters: readonly AgyAccountUsageMeterV1[];
}>;

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The account facts in agy's status payload (agy 1.5.15): `email`, `plan_tier` and `quota.<limit>` with
 * `remaining_fraction` and `reset_time`. It is not a published format, so a field that does not read is
 * left out, and a payload with no readable limit is no reading.
 */
export function readAgyAccountUsageFromStatus(status: unknown): AgyAccountUsageReading | null {
  if (!status || typeof status !== 'object') return null;
  const { email, plan_tier: planTier, quota } = status as { email?: unknown; plan_tier?: unknown; quota?: unknown };
  if (!quota || typeof quota !== 'object') return null;
  const meters: AgyAccountUsageMeterV1[] = [];
  for (const meterId of AGY_ACCOUNT_USAGE_METER_IDS) {
    const limit = (quota as Record<string, unknown>)[meterId];
    if (!limit || typeof limit !== 'object') continue;
    const { remaining_fraction: remaining, reset_time: resetTime } = limit as {
      remaining_fraction?: unknown;
      reset_time?: unknown;
    };
    if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 1) continue;
    const resetAtMs = typeof resetTime === 'string' ? Date.parse(resetTime) : Number.NaN;
    meters.push({
      meterId,
      remainingFraction: remaining,
      // agy's `/usage` names no reset for an untouched limit: its `reset_time` just stays a full window ahead.
      resetAtMs: remaining < 1 && Number.isFinite(resetAtMs) && resetAtMs >= 0 ? resetAtMs : null,
    });
  }
  if (meters.length === 0) return null;
  return { email: readText(email), planTier: readText(planTier), meters };
}
