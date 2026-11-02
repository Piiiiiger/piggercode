import { z } from 'zod';

/**
 * Username + password login for an end-to-end encrypted account.
 *
 * The password never leaves the client. The client stretches it with the KDF below and splits the
 * result into two keys: an auth key the server checks, and a wrapping key that encrypts the account
 * secret. The server keeps only a hash of the auth key, the KDF parameters and the wrapped secret.
 * After a successful login the client unwraps the secret and signs in with the existing key challenge,
 * so the token comes from the same place as every other login.
 */

export const PASSWORD_LOGIN_KEY_LABELS = Object.freeze({
  auth: 'piggercode/password-login/v1/auth',
  wrap: 'piggercode/password-login/v1/wrap',
});

/** Scrypt cost the client uses for new credentials; each stored credential keeps its own parameters. */
export const DEFAULT_PASSWORD_KDF_PARAMS = Object.freeze({ alg: 'scrypt', n: 1 << 15, r: 8, p: 1 } as const);

export const PASSWORD_MIN_LENGTH = 8;

export const PasswordKdfV1Schema = z.object({
  alg: z.literal('scrypt'),
  salt: z.string().min(16).max(128),
  n: z.number().int().min(1 << 14).max(1 << 20).refine((value) => (value & (value - 1)) === 0, 'n must be a power of two'),
  r: z.number().int().min(1).max(32),
  p: z.number().int().min(1).max(16),
}).strict();
export type PasswordKdfV1 = z.infer<typeof PasswordKdfV1Schema>;

const LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Login names are case-insensitive: 3–32 characters, letters, digits, `.`, `_` and `-`, starting with a letter or digit. */
export function normalizePasswordLoginName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return LOGIN_NAME_PATTERN.test(normalized) ? normalized : null;
}

const Base64KeySchema = z.string().min(40).max(64);
const WrappedSecretSchema = z.string().min(40).max(512);

export const PasswordLoginParamsRequestSchema = z.object({ username: z.string().min(1).max(64) }).strict();
export const PasswordLoginParamsResponseSchema = z.object({ kdf: PasswordKdfV1Schema }).strict();

export const PasswordLoginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  authKey: Base64KeySchema,
}).strict();
export const PasswordLoginResponseSchema = z.object({ wrappedSecret: WrappedSecretSchema }).strict();

export const AccountPasswordSetRequestSchema = z.object({
  username: z.string().min(1).max(64),
  kdf: PasswordKdfV1Schema,
  authKey: Base64KeySchema,
  wrappedSecret: WrappedSecretSchema,
}).strict();
export const AccountPasswordStatusResponseSchema = z.object({ username: z.string().nullable() }).strict();

export type PasswordLoginParamsResponse = z.infer<typeof PasswordLoginParamsResponseSchema>;
export type PasswordLoginResponse = z.infer<typeof PasswordLoginResponseSchema>;
export type AccountPasswordSetRequest = z.infer<typeof AccountPasswordSetRequestSchema>;
export type AccountPasswordStatusResponse = z.infer<typeof AccountPasswordStatusResponseSchema>;
