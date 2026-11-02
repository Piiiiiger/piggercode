import {
    AccountPasswordStatusResponseSchema,
    PASSWORD_MIN_LENGTH,
    PasswordLoginParamsResponseSchema,
    PasswordLoginResponseSchema,
    normalizePasswordLoginName,
} from '@piggercode/protocol';

import { authGetToken } from '@/auth/flows/getToken';
import { isLegacyAuthCredentials, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { serverFetch } from '@/sync/http/client';

import { createPasswordKdf, derivePasswordKeys, unwrapAccountSecret, wrapAccountSecret } from './passwordKeys';

export type PasswordLoginErrorCode =
    | 'invalid-credentials'
    | 'invalid-username'
    | 'password-too-short'
    | 'username-taken'
    | 'secret-unavailable'
    | 'unavailable';

export class PasswordLoginError extends Error {
    constructor(readonly code: PasswordLoginErrorCode) {
        super(`Password login failed: ${code}`);
        this.name = 'PasswordLoginError';
    }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function postJson(path: string, body: unknown, token?: string): Promise<Response> {
    return await serverFetch(path, {
        method: 'POST',
        headers: token ? { ...JSON_HEADERS, Authorization: `Bearer ${token}` } : JSON_HEADERS,
        body: JSON.stringify(body),
    }, { includeAuth: false });
}

/**
 * Signs in with a username and password. The password is stretched on this device; the server only
 * releases the wrapped account secret for the matching key, and the token then comes from the regular
 * key challenge. Returns what `auth.login` stores, so the session survives reloads like any other login.
 */
export async function loginWithPassword(params: Readonly<{ username: string; password: string }>): Promise<{ token: string; secret: string }> {
    const username = normalizePasswordLoginName(params.username);
    if (!username || params.password.length === 0) throw new PasswordLoginError('invalid-credentials');

    const paramsResponse = await postJson('/v1/auth/password/params', { username });
    const parsedParams = PasswordLoginParamsResponseSchema.safeParse(await paramsResponse.json().catch(() => null));
    if (!paramsResponse.ok || !parsedParams.success) throw new PasswordLoginError('unavailable');

    const keys = await derivePasswordKeys(params.password, parsedParams.data.kdf);
    const loginResponse = await postJson('/v1/auth/password/login', { username, authKey: encodeBase64(keys.authKey) });
    if (loginResponse.status === 401) throw new PasswordLoginError('invalid-credentials');
    const parsedLogin = PasswordLoginResponseSchema.safeParse(await loginResponse.json().catch(() => null));
    if (!loginResponse.ok || !parsedLogin.success) throw new PasswordLoginError('unavailable');

    const secret = unwrapAccountSecret(parsedLogin.data.wrappedSecret, keys.wrapKey);
    if (!secret) throw new PasswordLoginError('invalid-credentials');
    const token = await authGetToken(decodeBase64(secret, 'base64url'));
    if (!token) throw new PasswordLoginError('unavailable');
    return { token, secret };
}

/** Sets or replaces the signed-in account's username and password. Needs the account secret on this device. */
export async function setAccountPassword(params: Readonly<{
    credentials: AuthCredentials;
    username: string;
    password: string;
}>): Promise<string> {
    if (!isLegacyAuthCredentials(params.credentials)) throw new PasswordLoginError('secret-unavailable');
    const username = normalizePasswordLoginName(params.username);
    if (!username) throw new PasswordLoginError('invalid-username');
    if (params.password.length < PASSWORD_MIN_LENGTH) throw new PasswordLoginError('password-too-short');

    const kdf = createPasswordKdf();
    const keys = await derivePasswordKeys(params.password, kdf);
    const response = await postJson('/v1/account/password', {
        username,
        kdf,
        authKey: encodeBase64(keys.authKey),
        wrappedSecret: wrapAccountSecret(params.credentials.secret, keys.wrapKey),
    }, params.credentials.token);
    if (response.status === 409) throw new PasswordLoginError('username-taken');
    if (response.status === 400) throw new PasswordLoginError('invalid-username');
    const parsed = AccountPasswordStatusResponseSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success || !parsed.data.username) throw new PasswordLoginError('unavailable');
    return parsed.data.username;
}

/** The signed-in account's login name, or null when it has no password yet. */
export async function readAccountPasswordUsername(credentials: AuthCredentials): Promise<string | null> {
    const response = await serverFetch('/v1/account/password', {
        method: 'GET',
        headers: { Authorization: `Bearer ${credentials.token}` },
    }, { includeAuth: false });
    const parsed = AccountPasswordStatusResponseSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) throw new PasswordLoginError('unavailable');
    return parsed.data.username;
}
