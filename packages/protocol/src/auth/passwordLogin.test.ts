import { describe, expect, it } from 'vitest';

import {
  AccountPasswordSetRequestSchema,
  DEFAULT_PASSWORD_KDF_PARAMS,
  PasswordKdfV1Schema,
  normalizePasswordLoginName,
} from './passwordLogin.js';

describe('password login contract', () => {
  it('normalizes login names case-insensitively and rejects unusable ones', () => {
    expect(normalizePasswordLoginName('  Pigger ')).toBe('pigger');
    expect(normalizePasswordLoginName('a.b_c-9')).toBe('a.b_c-9');
    expect(normalizePasswordLoginName('ab')).toBeNull();
    expect(normalizePasswordLoginName('-leading')).toBeNull();
    expect(normalizePasswordLoginName('has space')).toBeNull();
    expect(normalizePasswordLoginName('x'.repeat(33))).toBeNull();
    expect(normalizePasswordLoginName(42)).toBeNull();
  });

  it('accepts the default scrypt parameters and rejects weak or malformed ones', () => {
    const salt = 'c2FsdHNhbHRzYWx0c2FsdA==';
    expect(PasswordKdfV1Schema.safeParse({ ...DEFAULT_PASSWORD_KDF_PARAMS, salt }).success).toBe(true);
    expect(PasswordKdfV1Schema.safeParse({ ...DEFAULT_PASSWORD_KDF_PARAMS, salt, n: 1024 }).success).toBe(false);
    expect(PasswordKdfV1Schema.safeParse({ ...DEFAULT_PASSWORD_KDF_PARAMS, salt, n: 3 * (1 << 14) }).success).toBe(false);
    expect(PasswordKdfV1Schema.safeParse({ ...DEFAULT_PASSWORD_KDF_PARAMS, salt: 'short' }).success).toBe(false);
  });

  it('requires every field of a credential update', () => {
    const kdf = { ...DEFAULT_PASSWORD_KDF_PARAMS, salt: 'c2FsdHNhbHRzYWx0c2FsdA==' };
    const authKey = 'A'.repeat(43) + '=';
    const wrappedSecret = 'B'.repeat(116);
    expect(AccountPasswordSetRequestSchema.safeParse({ username: 'pigger', kdf, authKey, wrappedSecret }).success).toBe(true);
    expect(AccountPasswordSetRequestSchema.safeParse({ username: 'pigger', kdf, authKey }).success).toBe(false);
  });
});
