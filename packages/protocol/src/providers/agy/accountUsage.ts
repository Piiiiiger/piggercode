import { z } from 'zod';

/** A machine without end-to-end encryption keeps its agy usage to itself: the relay could read the RPC. */
export const AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION = 'agy_account_usage_requires_encryption';

/** The login agy uses in the real home. Further logins are folders, named by their folder. */
export const AGY_DEFAULT_ACCOUNT_ID = 'default';

/** One limit agy reports for the Google account it is signed in to. */
export const AgyAccountUsageMeterV1Schema = z.object({
  meterId: z.string().trim().min(1),
  remainingFraction: z.number().finite().min(0).max(1),
  resetAtMs: z.number().int().nonnegative().nullable(),
});
export type AgyAccountUsageMeterV1 = z.infer<typeof AgyAccountUsageMeterV1Schema>;

/**
 * What a running agy session saw for its account, from the session to its machine's daemon. `accountId`
 * names the login the reporting agy runs on (absent from a CLI that only ever ran the default login);
 * `runnerKey` and `childEpoch` name the session's runner and which agy process of it reports, so a late
 * reading from a process that was replaced never lands after a newer one.
 */
export const AgyAccountUsageReportV1Schema = z.object({
  email: z.string().trim().min(1).nullable(),
  planTier: z.string().trim().min(1).nullable(),
  observedAtMs: z.number().int().nonnegative(),
  meters: z.array(AgyAccountUsageMeterV1Schema).min(1),
  accountId: z.string().trim().min(1).optional(),
  runnerKey: z.string().trim().min(1).optional(),
  childEpoch: z.number().int().positive().optional(),
});
export type AgyAccountUsageReportV1 = z.infer<typeof AgyAccountUsageReportV1Schema>;

/**
 * One Google login agy has on a machine, with the limits it last showed. It stays in a file on that machine
 * and travels only through the machine RPC of an end-to-end encrypted machine; the relay never stores it.
 * `accountId` is the login's local name (`default`, or its folder), so what does reach the relay (such as a
 * collapsed-row setting) never names the Google account.
 */
export const AgyAccountUsageV1Schema = z.object({
  accountId: z.string().trim().min(1),
  email: z.string().trim().min(1).nullable(),
  planTier: z.string().trim().min(1).nullable(),
  /** Null until agy has shown this login's limits. */
  observedAtMs: z.number().int().nonnegative().nullable(),
  meters: z.array(AgyAccountUsageMeterV1Schema),
});
export type AgyAccountUsageV1 = z.infer<typeof AgyAccountUsageV1Schema>;

export const AgyAccountUsageReadRequestV1Schema = z.object({
  /** The refresh button: starts agy once on this login to read its limits. */
  refreshAccountId: z.string().trim().min(1).optional(),
});
export type AgyAccountUsageReadRequestV1 = z.infer<typeof AgyAccountUsageReadRequestV1Schema>;

export const AgyAccountUsageReadResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    accounts: z.array(AgyAccountUsageV1Schema),
    /** After a refresh: whether agy reported that login's limits. */
    refreshed: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false), errorCode: z.string().trim().min(1) }),
]);
export type AgyAccountUsageReadResponseV1 = z.infer<typeof AgyAccountUsageReadResponseV1Schema>;

/** agy's limits by model group: Gemini models share one pair, third-party models (Claude, GPT-OSS) another. */
export type AgyModelGroup = 'gemini' | 'third_party';

/** agy's usage windows: its 5-hour and weekly limits. */
export const AGY_FIVE_HOUR_WINDOW_MS = 5 * 60 * 60_000;
export const AGY_WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * The model group of an agy model id. A session started without a model runs agy's default model, which is
 * a Gemini model; so does any id this does not recognise as a third-party one.
 */
export function resolveAgyModelGroup(modelId: string | null | undefined): AgyModelGroup {
  const id = modelId?.trim().toLowerCase() ?? '';
  return id.startsWith('claude') || id.startsWith('gpt-oss') ? 'third_party' : 'gemini';
}

/**
 * The limits that decide whether an account can run a model: its group's 5-hour and weekly limits, and for an
 * Argon model also the Argon weekly limit.
 */
export function resolveAgyRelevantMeterIds(modelId: string | null | undefined): readonly string[] {
  if (resolveAgyModelGroup(modelId) === 'third_party') return ['3p-5h', '3p-weekly'];
  const argon = (modelId?.toLowerCase() ?? '').includes('argon');
  return argon ? ['gemini-5h', 'gemini-weekly', 'gemini-argon-wtu-weekly'] : ['gemini-5h', 'gemini-weekly'];
}

/** The length of the window a meter measures; null for a meter this does not know. */
export function resolveAgyMeterWindowMs(meterId: string): number | null {
  if (meterId.endsWith('-5h')) return AGY_FIVE_HOUR_WINDOW_MS;
  if (meterId.endsWith('weekly')) return AGY_WEEKLY_WINDOW_MS;
  return null;
}
