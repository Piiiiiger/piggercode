import type { Mock } from 'vitest';

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export type FakePasswordRelay = Readonly<{
    keyChallengeBodies: Array<Record<string, unknown>>;
    readStored: () => Readonly<{ username: string; kdf: unknown; authKey: string; wrappedSecret: string }> | null;
}>;

/**
 * Stands in for the relay at the network boundary (`runtimeFetch`): it keeps the credential it is given,
 * answers the params and login routes the way the server does, and issues a token for the key challenge.
 */
export function installFakePasswordRelay(
    runtimeFetchMock: Mock,
    options: Readonly<{ takenUsernames?: readonly string[] }> = {},
): FakePasswordRelay {
    let stored: { username: string; kdf: unknown; authKey: string; wrappedSecret: string } | null = null;
    const keyChallengeBodies: Array<Record<string, unknown>> = [];
    runtimeFetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        switch (url.pathname) {
            // Reachability probes the app sends before (or alongside) the auth requests.
            case '/v1/auth/ping':
            case '/health':
                return json(200, { ok: true });
            case '/v1/version':
                return json(200, { version: '1' });
            case '/v1/account/password':
                if ((init?.method ?? 'GET') === 'GET') return json(200, { username: stored?.username ?? null });
                if (options.takenUsernames?.includes(body.username)) return json(409, { error: 'username-taken' });
                stored = { username: body.username, kdf: body.kdf, authKey: body.authKey, wrappedSecret: body.wrappedSecret };
                return json(200, { username: body.username });
            case '/v1/auth/password/params':
                return stored && stored.username === body.username
                    ? json(200, { kdf: stored.kdf })
                    : json(200, { kdf: { alg: 'scrypt', n: 1 << 15, r: 8, p: 1, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' } });
            case '/v1/auth/password/login':
                return stored && stored.username === body.username && stored.authKey === body.authKey
                    ? json(200, { wrappedSecret: stored.wrappedSecret })
                    : json(401, { error: 'invalid-credentials' });
            case '/v1/auth':
                keyChallengeBodies.push(body);
                return json(200, { success: true, token: 'token-from-key-challenge' });
            default:
                return json(404, { error: 'not-found' });
        }
    });
    return { keyChallengeBodies, readStored: () => stored };
}
