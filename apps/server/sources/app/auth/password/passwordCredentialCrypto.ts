import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { DEFAULT_PASSWORD_KDF_PARAMS, type PasswordKdfV1 } from "@piggercode/protocol";
import * as privacyKit from "privacy-kit";

/**
 * The client sends a key it derived from the password with a slow KDF. The server hashes that key once
 * more before storing it, so a copy of the database alone cannot be replayed as a login.
 */
const VERIFIER_SCRYPT = Object.freeze({ N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const VERIFIER_KEY_LENGTH = 32;
const VERIFIER_SALT_LENGTH = 16;

function scryptAsync(key: Uint8Array, salt: Uint8Array): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(key, salt, VERIFIER_KEY_LENGTH, VERIFIER_SCRYPT, (error, derived) => {
            if (error) reject(error);
            else resolve(derived);
        });
    });
}

/** Returns ArrayBuffer-backed copies, the byte type Prisma stores. */
export async function createPasswordVerifier(authKey: Uint8Array): Promise<{ salt: Uint8Array<ArrayBuffer>; hash: Uint8Array<ArrayBuffer> }> {
    const salt = randomBytes(VERIFIER_SALT_LENGTH);
    const hash = await scryptAsync(authKey, salt);
    return { salt: new Uint8Array(salt), hash: new Uint8Array(hash) };
}

export async function matchesPasswordVerifier(authKey: Uint8Array, salt: Uint8Array, hash: Uint8Array): Promise<boolean> {
    const candidate = await scryptAsync(authKey, salt);
    return candidate.length === hash.length && timingSafeEqual(candidate, Buffer.from(hash));
}

/**
 * Parameters for a login name that has no credential. They are derived from the server secret, so the
 * same name always gets the same answer and a caller cannot tell a free name from a taken one.
 */
export function buildUnknownLoginKdf(loginName: string, masterSecret: string): PasswordKdfV1 {
    const salt = createHmac("sha256", masterSecret).update(`piggercode/password-login/v1/salt:${loginName}`).digest().subarray(0, 16);
    return { ...DEFAULT_PASSWORD_KDF_PARAMS, salt: privacyKit.encodeBase64(new Uint8Array(salt)) };
}

export function decodeAuthKey(raw: string): Uint8Array | null {
    try {
        const bytes = privacyKit.decodeBase64(raw);
        return bytes.length === 32 ? bytes : null;
    } catch {
        return null;
    }
}

export function decodeWrappedSecret(raw: string): Uint8Array<ArrayBuffer> | null {
    try {
        const bytes = privacyKit.decodeBase64(raw);
        // secretbox nonce (24) + MAC (16) + a non-empty payload
        return bytes.length > 40 && bytes.length <= 384 ? Uint8Array.from(bytes) : null;
    } catch {
        return null;
    }
}
