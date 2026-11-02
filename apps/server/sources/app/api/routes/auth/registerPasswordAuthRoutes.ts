import { z } from "zod";
import * as privacyKit from "privacy-kit";
import {
    AccountPasswordSetRequestSchema,
    AccountPasswordStatusResponseSchema,
    PasswordKdfV1Schema,
    PasswordLoginParamsRequestSchema,
    PasswordLoginParamsResponseSchema,
    PasswordLoginRequestSchema,
    PasswordLoginResponseSchema,
    normalizePasswordLoginName,
} from "@piggercode/protocol";

import { db } from "@/storage/db";
import { enforceLoginEligibility } from "@/app/auth/enforceLoginEligibility";
import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import {
    buildUnknownLoginKdf,
    createPasswordVerifier,
    decodeAuthKey,
    decodeWrappedSecret,
    matchesPasswordVerifier,
} from "@/app/auth/password/passwordCredentialCrypto";
import { type Fastify } from "../../types";

const errorBody = <T extends string>(...codes: [T, ...T[]]) => z.object({ error: z.enum(codes) });

function requireMasterSecret(): string {
    const secret = (process.env.HANDY_MASTER_SECRET ?? "").toString().trim();
    if (!secret) throw new Error("HANDY_MASTER_SECRET is required");
    return secret;
}

function readStoredKdf(raw: string) {
    try {
        const parsed = PasswordKdfV1Schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/** Spends the same verifier work as a real check, so a login for an unknown name takes as long as a wrong password. */
const UNKNOWN_LOGIN_VERIFIER = { salt: new Uint8Array(16), hash: new Uint8Array(32) };

function isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
}

/**
 * Username + password login (see `@piggercode/protocol` `auth/passwordLogin`).
 *
 * - `POST /v1/auth/password/params` returns the KDF parameters for a login name. Unknown names get
 *   stable parameters derived from the server secret, so the answer does not reveal whether a name exists.
 * - `POST /v1/auth/password/login` checks the client-derived auth key and returns the wrapped account
 *   secret. The client then signs in with the key challenge (`/v1/auth`), which issues the token.
 * - `GET|POST|DELETE /v1/account/password` read, set or clear the signed-in account's credential.
 */
export function registerPasswordAuthRoutes(app: Fastify): void {
    app.post("/v1/auth/password/params", {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.password.params") },
        schema: {
            body: PasswordLoginParamsRequestSchema,
            response: {
                200: PasswordLoginParamsResponseSchema,
                400: errorBody("invalid-username"),
            },
        },
    }, async (request, reply) => {
        const loginName = normalizePasswordLoginName(request.body.username);
        if (!loginName) return reply.code(400).send({ error: "invalid-username" });

        const credential = await db.accountPasswordCredential.findUnique({
            where: { loginName },
            select: { kdf: true },
        });
        const kdf = (credential ? readStoredKdf(credential.kdf) : null) ?? buildUnknownLoginKdf(loginName, requireMasterSecret());
        return reply.send({ kdf });
    });

    app.post("/v1/auth/password/login", {
        config: { rateLimit: resolveApiHotEndpointRateLimit(process.env, "auth.password.login") },
        schema: {
            body: PasswordLoginRequestSchema,
            response: {
                200: PasswordLoginResponseSchema,
                401: errorBody("invalid-credentials"),
                403: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        const loginName = normalizePasswordLoginName(request.body.username);
        const authKey = decodeAuthKey(request.body.authKey);
        const credential = loginName
            ? await db.accountPasswordCredential.findUnique({
                where: { loginName },
                select: { accountId: true, verifierSalt: true, verifierHash: true, wrappedSecret: true },
            })
            : null;
        if (!credential || !authKey) {
            await matchesPasswordVerifier(authKey ?? new Uint8Array(32), UNKNOWN_LOGIN_VERIFIER.salt, UNKNOWN_LOGIN_VERIFIER.hash);
            return reply.code(401).send({ error: "invalid-credentials" });
        }
        const matches = await matchesPasswordVerifier(
            authKey,
            new Uint8Array(credential.verifierSalt),
            new Uint8Array(credential.verifierHash),
        );
        if (!matches) {
            return reply.code(401).send({ error: "invalid-credentials" });
        }
        const eligibility = await enforceLoginEligibility({ accountId: credential.accountId, env: process.env });
        if (!eligibility.ok) {
            if (eligibility.statusCode === 401) return reply.code(401).send({ error: "invalid-credentials" });
            return reply.code(403).send({ error: eligibility.error });
        }
        return reply.send({ wrappedSecret: privacyKit.encodeBase64(new Uint8Array(credential.wrappedSecret)) });
    });

    app.get("/v1/account/password", {
        preHandler: app.authenticate,
        schema: { response: { 200: AccountPasswordStatusResponseSchema } },
    }, async (request, reply) => {
        const credential = await db.accountPasswordCredential.findUnique({
            where: { accountId: request.userId },
            select: { loginName: true },
        });
        return reply.send({ username: credential?.loginName ?? null });
    });

    app.post("/v1/account/password", {
        preHandler: app.authenticate,
        schema: {
            body: AccountPasswordSetRequestSchema,
            response: {
                200: AccountPasswordStatusResponseSchema,
                400: errorBody("invalid-username", "invalid-request"),
                409: errorBody("username-taken"),
            },
        },
    }, async (request, reply) => {
        const loginName = normalizePasswordLoginName(request.body.username);
        if (!loginName) return reply.code(400).send({ error: "invalid-username" });
        const authKey = decodeAuthKey(request.body.authKey);
        const wrappedSecret = decodeWrappedSecret(request.body.wrappedSecret);
        if (!authKey || !wrappedSecret) return reply.code(400).send({ error: "invalid-request" });

        const holder = await db.accountPasswordCredential.findUnique({
            where: { loginName },
            select: { accountId: true },
        });
        if (holder && holder.accountId !== request.userId) {
            return reply.code(409).send({ error: "username-taken" });
        }

        const verifier = await createPasswordVerifier(authKey);
        const data = {
            loginName,
            kdf: JSON.stringify(request.body.kdf),
            verifierSalt: verifier.salt,
            verifierHash: verifier.hash,
            wrappedSecret,
        };
        try {
            await db.accountPasswordCredential.upsert({
                where: { accountId: request.userId },
                update: data,
                create: { accountId: request.userId, ...data },
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) return reply.code(409).send({ error: "username-taken" });
            throw error;
        }
        return reply.send({ username: loginName });
    });

    app.delete("/v1/account/password", {
        preHandler: app.authenticate,
        schema: { response: { 200: AccountPasswordStatusResponseSchema } },
    }, async (request, reply) => {
        await db.accountPasswordCredential.deleteMany({ where: { accountId: request.userId } });
        return reply.send({ username: null });
    });
}
