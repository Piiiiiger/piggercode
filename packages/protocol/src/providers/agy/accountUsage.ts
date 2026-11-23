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

/** What a running agy session saw for its account, from the session to its machine's daemon. */
export const AgyAccountUsageReportV1Schema = z.object({
  email: z.string().trim().min(1).nullable(),
  planTier: z.string().trim().min(1).nullable(),
  observedAtMs: z.number().int().nonnegative(),
  meters: z.array(AgyAccountUsageMeterV1Schema).min(1),
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
