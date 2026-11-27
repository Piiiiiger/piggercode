import { z } from 'zod';

/**
 * What the app shows about an agy session's login: written by the session's runner into the session metadata
 * (`agyAccountSwitchV1`), read by the app. An older app ignores it; an older CLI never writes it.
 */
export const AgyAccountSwitchStateV1Schema = z.object({
  v: z.literal(1),
  state: z.enum(['none', 'waiting', 'needs_confirmation', 'switched', 'all_exhausted', 'failed']),
  fromAccountId: z.string().trim().min(1).optional(),
  toAccountId: z.string().trim().min(1).optional(),
  reason: z.enum(['exhausted', 'low']).optional(),
  /** What a waiting switch still waits for. */
  waitingFor: z.enum(['idle', 'input', 'draft', 'conversation', 'unknown_input']).optional(),
  earliestResetAtMs: z.number().int().nonnegative().nullable().optional(),
  requestId: z.string().trim().min(1).optional(),
  failure: z.enum(['target_start_failed', 'source_start_failed']).optional(),
  /** The session runs on a login other than the default one, inside a namespace where `sudo` cannot work. */
  sudoUnavailable: z.boolean().optional(),
  updatedAtMs: z.number().int().nonnegative(),
});
export type AgyAccountSwitchStateV1 = z.infer<typeof AgyAccountSwitchStateV1Schema>;

/** Session RPC (app to runner): the user confirms a switch that waits because background work may be running. */
export const AGY_ACCOUNT_SWITCH_CONFIRM_RPC_METHOD = 'agy.accountSwitch.confirm';

export const AgyAccountSwitchConfirmRequestV1Schema = z.object({ requestId: z.string().trim().min(1) });
export type AgyAccountSwitchConfirmRequestV1 = z.infer<typeof AgyAccountSwitchConfirmRequestV1Schema>;

export const AgyAccountSwitchConfirmResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.enum(['no_request', 'stale_request', 'not_supported']) }),
]);
export type AgyAccountSwitchConfirmResponseV1 = z.infer<typeof AgyAccountSwitchConfirmResponseV1Schema>;

/** Why a login cannot be picked on this machine, reported with the launch choice. */
export const AgyLoginUnavailableReasonSchema = z.enum(['namespace_unavailable', 'login_incomplete', 'needs_sign_in']);
export type AgyLoginUnavailableReason = z.infer<typeof AgyLoginUnavailableReasonSchema>;

/** Runner to daemon, before agy starts: which login should this session run on? */
export const AgyLaunchAccountRequestV1Schema = z.object({
  /** One per runner; the daemon counts the launch against the chosen login until this runner reports. */
  runnerKey: z.string().trim().min(1),
  modelId: z.string().trim().min(1).nullable(),
});
export type AgyLaunchAccountRequestV1 = z.infer<typeof AgyLaunchAccountRequestV1Schema>;

export const AgyLaunchAccountResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    accountId: z.string().trim().min(1),
    /** The chosen login's folder on this machine; null for the default login (agy's own home). */
    accountHomeDir: z.string().trim().min(1).nullable(),
    unavailable: z.array(z.object({ accountId: z.string().trim().min(1), reason: AgyLoginUnavailableReasonSchema })),
  }),
  z.object({ ok: z.literal(false), errorCode: z.string().trim().min(1) }),
]);
export type AgyLaunchAccountResponseV1 = z.infer<typeof AgyLaunchAccountResponseV1Schema>;

/** The daemon's request that a running session move to another login. */
export const AgyAccountSwitchRequestV1Schema = z.object({
  requestId: z.string().trim().min(1),
  toAccountId: z.string().trim().min(1),
  toAccountHomeDir: z.string().trim().min(1).nullable(),
  reason: z.enum(['exhausted', 'low']),
});
export type AgyAccountSwitchRequestV1 = z.infer<typeof AgyAccountSwitchRequestV1Schema>;

/**
 * The daemon's answer to a session's signals. `switch`: move to the login in `request` when it is safe;
 * `all_exhausted`: no login can run the session's model until `earliestResetAtMs`; `recovered`: the session's
 * own login has quota again (`continuationPrompt`: what to type once if the last turn was cut off by the limit).
 */
export const AgyAccountDecisionV1Schema = z.object({
  action: z.enum(['none', 'switch', 'all_exhausted', 'recovered']),
  request: AgyAccountSwitchRequestV1Schema.optional(),
  earliestResetAtMs: z.number().int().nonnegative().nullable().optional(),
  continuationPrompt: z.string().min(1).optional(),
});
export type AgyAccountDecisionV1 = z.infer<typeof AgyAccountDecisionV1Schema>;

/** Runner to daemon while agy runs. */
export const AgyAccountSessionRequestV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('signals'),
    runnerKey: z.string().trim().min(1),
    accountId: z.string().trim().min(1),
    childEpoch: z.number().int().positive(),
    /** The model agy shows now; null when unknown. */
    modelId: z.string().trim().min(1).nullable(),
    conversationId: z.string().trim().min(1).nullable(),
    /** agy's quota-reached line appeared on screen since this process started and nothing was typed since. */
    limitHit: z.boolean(),
  }),
  /** Right before agy is stopped: is the request still wanted? */
  z.object({ kind: z.literal('confirm'), runnerKey: z.string().trim().min(1), requestId: z.string().trim().min(1) }),
  z.object({
    kind: z.literal('result'),
    runnerKey: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
    outcome: z.enum(['switched', 'target_failed', 'source_failed', 'abandoned']),
  }),
  /** agy on this login showed its sign-in screen: the login needs signing in and is left out of the choice. */
  z.object({
    kind: z.literal('login_unusable'),
    runnerKey: z.string().trim().min(1),
    accountId: z.string().trim().min(1),
    reason: z.literal('needs_sign_in'),
  }),
  z.object({ kind: z.literal('ended'), runnerKey: z.string().trim().min(1) }),
]);
export type AgyAccountSessionRequestV1 = z.infer<typeof AgyAccountSessionRequestV1Schema>;

export const AgyAccountSessionResponseV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** Answer to `signals`. */
    decision: AgyAccountDecisionV1Schema.optional(),
    /** Answer to `confirm`. */
    valid: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false), errorCode: z.string().trim().min(1) }),
]);
export type AgyAccountSessionResponseV1 = z.infer<typeof AgyAccountSessionResponseV1Schema>;
