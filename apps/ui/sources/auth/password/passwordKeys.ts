import { hmac } from '@noble/hashes/hmac';
import { scryptAsync } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';
import { DEFAULT_PASSWORD_KDF_PARAMS, PASSWORD_LOGIN_KEY_LABELS, type PasswordKdfV1 } from '@piggercode/protocol';

import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { decryptSecretBox, encryptSecretBox } from '@/encryption/libsodium';
import { getRandomBytes } from '@/platform/cryptoRandom';

export type PasswordKeys = Readonly<{ authKey: Uint8Array; wrapKey: Uint8Array }>;

/**
 * Stretches the password with the credential's scrypt parameters and splits the result into the key
 * the server checks and the key that wraps the account secret. The two never coincide, so the server
 * cannot unwrap the secret with what it is sent.
 */
export async function derivePasswordKeys(password: string, kdf: PasswordKdfV1): Promise<PasswordKeys> {
    const master = await scryptAsync(utf8ToBytes(password.normalize('NFKC')), decodeBase64(kdf.salt), {
        N: kdf.n,
        r: kdf.r,
        p: kdf.p,
        dkLen: 32,
    });
    return {
        authKey: hmac(sha256, master, utf8ToBytes(PASSWORD_LOGIN_KEY_LABELS.auth)),
        wrapKey: hmac(sha256, master, utf8ToBytes(PASSWORD_LOGIN_KEY_LABELS.wrap)),
    };
}

export function createPasswordKdf(): PasswordKdfV1 {
    return { ...DEFAULT_PASSWORD_KDF_PARAMS, salt: encodeBase64(getRandomBytes(16)) };
}

/** The account secret travels as its base64url string inside the box, the same form the app stores. */
export function wrapAccountSecret(secretBase64Url: string, wrapKey: Uint8Array): string {
    return encodeBase64(encryptSecretBox(secretBase64Url, wrapKey));
}

export function unwrapAccountSecret(wrappedSecret: string, wrapKey: Uint8Array): string | null {
    const opened: unknown = decryptSecretBox(decodeBase64(wrappedSecret), wrapKey);
    return typeof opened === 'string' && opened.length > 0 ? opened : null;
}
