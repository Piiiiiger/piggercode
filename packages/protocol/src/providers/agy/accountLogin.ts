import { z } from 'zod';

/**
 * Adding a Google login to agy from the app happens only on an end-to-end encrypted machine: the code the person
 * pastes travels to the machine in this RPC, and the relay could read a plain machine's RPC.
 */
export const AGY_ACCOUNT_LOGIN_REQUIRES_ENCRYPTION = 'agy_account_login_requires_encryption';

/** What a login attempt answers instead of a result. A newer CLI may send others: readers treat those as a failure. */
export const AgyAccountLoginErrorCodeSchema = z.enum([
  'invalid_parameters',
  /** This CLI cannot add logins (an older one answers with no handler at all). */
  'agy_account_login_unavailable',
  AGY_ACCOUNT_LOGIN_REQUIRES_ENCRYPTION,
  /** Only Linux keeps a second agy login apart: elsewhere agy may keep it in the system keyring. */
  'unsupported_platform',
  'agy_not_installed',
  /** The attempt ended (finished, cancelled, or left too long), or this machine restarted. */
  'login_not_found',
  /** agy did not show its Google sign-in page. */
  'login_page_not_shown',
  /** The paste holds no code: nothing was typed, and the same sign-in takes another paste. */
  'code_unreadable',
  /** agy did not sign in with the pasted code. */
  'code_not_accepted',
  /**
   * The Google account that signed in is this machine's main agy login (the real home's). Nothing was added; that
   * login is signed in again in agy itself.
   */
  'account_is_main_login',
  /** The main login is the real home's own agy login: the app does not remove it. */
  'login_not_removable',
  /** Something on the machine failed (named only by this code: its details would name local paths). */
  'login_failed',
]);
export type AgyAccountLoginErrorCode = z.infer<typeof AgyAccountLoginErrorCodeSchema>;

const LoginIdSchema = z.string().trim().min(1).max(64);
/** A login's folder name, as the machine lists it. */
const AccountIdSchema = z.string().trim().min(1).max(64);

export const AgyAccountLoginRequestV1Schema = z.discriminatedUnion('action', [
  /** Makes a new login folder and starts the official agy in it, up to its Google sign-in page. */
  z.object({ action: z.literal('start') }).strict(),
  /** Types the code Google showed into that agy, which signs in and keeps its token in that folder. */
  z.object({ action: z.literal('submit'), loginId: LoginIdSchema, code: z.string().trim().min(1).max(4096) }).strict(),
  /** Stops that agy; a folder that never signed in is removed. */
  z.object({ action: z.literal('cancel'), loginId: LoginIdSchema }).strict(),
  /** Removes an added login and its folder from the machine. The main login cannot be removed. */
  z.object({ action: z.literal('remove'), accountId: AccountIdSchema }).strict(),
]);
export type AgyAccountLoginRequestV1 = z.infer<typeof AgyAccountLoginRequestV1Schema>;

export const AgyAccountLoginResponseV1Schema = z.union([
  z.object({
    ok: z.literal(true),
    action: z.literal('start'),
    loginId: LoginIdSchema,
    /** The new login's folder name: what the usage page lists it under. */
    accountId: z.string().trim().min(1),
    /** agy's Google sign-in page. */
    url: z.string().url().max(8192),
  }),
  z.object({
    ok: z.literal(true),
    action: z.literal('submit'),
    /** The login has signed in and is in the machine's list; its limits are read right after. */
    accountId: z.string().trim().min(1),
    /**
     * The Google account was already one of the machine's added logins: that login was signed in again in place
     * (keeping its name) rather than listed twice. Absent from older machines.
     */
    replaced: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(true), action: z.literal('cancel') }),
  z.object({ ok: z.literal(true), action: z.literal('remove') }),
  z.object({ ok: z.literal(false), errorCode: z.string().trim().min(1) }),
]);
export type AgyAccountLoginResponseV1 = z.infer<typeof AgyAccountLoginResponseV1Schema>;
