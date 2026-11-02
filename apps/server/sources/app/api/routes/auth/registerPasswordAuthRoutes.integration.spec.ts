import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as privacyKit from "privacy-kit";

import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { registerPasswordAuthRoutes } from "./registerPasswordAuthRoutes";

const kdf = { alg: "scrypt", n: 1 << 15, r: 8, p: 1, salt: privacyKit.encodeBase64(new Uint8Array(randomBytes(16))) } as const;
const b64 = (bytes: Uint8Array) => privacyKit.encodeBase64(Uint8Array.from(bytes));

describe("password login routes (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "piggercode-password-login-", initAuth: false });
        await auth.init();
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    afterEach(async () => {
        await harness.resetDbTables([
            () => db.accountPasswordCredential.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("stores a credential, answers params without revealing names, and releases the wrapped secret only for the right key", async () => {
        await withAuthenticatedTestApp(
            (app) => registerPasswordAuthRoutes(app as any),
            async (app) => {
                const owner = await db.account.create({ data: { publicKey: "pk-password-owner" }, select: { id: true } });
                const other = await db.account.create({ data: { publicKey: "pk-password-other" }, select: { id: true } });
                const authKey = new Uint8Array(randomBytes(32));
                const wrappedSecret = new Uint8Array(randomBytes(85));
                const post = (url: string, payload: unknown, userId?: string) => app.inject({
                    method: "POST",
                    url,
                    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
                    payload,
                });

                const set = await post("/v1/account/password", {
                    username: "Pigger", kdf, authKey: b64(authKey), wrappedSecret: b64(wrappedSecret),
                }, owner.id);
                expect(set.statusCode).toBe(200);
                expect(set.json()).toEqual({ username: "pigger" });

                const status = await app.inject({ method: "GET", url: "/v1/account/password", headers: { "x-test-user-id": owner.id } });
                expect(status.json()).toEqual({ username: "pigger" });

                const known = await post("/v1/auth/password/params", { username: "PIGGER" });
                expect(known.statusCode).toBe(200);
                expect(known.json()).toEqual({ kdf });

                const unknownFirst = await post("/v1/auth/password/params", { username: "nobody" });
                const unknownSecond = await post("/v1/auth/password/params", { username: "nobody" });
                expect(unknownFirst.statusCode).toBe(200);
                expect(unknownFirst.json()).toEqual(unknownSecond.json());
                expect(unknownFirst.json().kdf.salt).not.toBe(kdf.salt);

                const login = await post("/v1/auth/password/login", { username: "pigger", authKey: b64(authKey) });
                expect(login.statusCode).toBe(200);
                expect(login.json()).toEqual({ wrappedSecret: b64(wrappedSecret) });

                const wrongKey = await post("/v1/auth/password/login", { username: "pigger", authKey: b64(new Uint8Array(32)) });
                expect(wrongKey.statusCode).toBe(401);
                expect(wrongKey.json()).toEqual({ error: "invalid-credentials" });

                const unknownLogin = await post("/v1/auth/password/login", { username: "nobody", authKey: b64(authKey) });
                expect(unknownLogin.statusCode).toBe(401);

                const taken = await post("/v1/account/password", {
                    username: "pigger", kdf, authKey: b64(authKey), wrappedSecret: b64(wrappedSecret),
                }, other.id);
                expect(taken.statusCode).toBe(409);
                expect(taken.json()).toEqual({ error: "username-taken" });

                const stored = await db.accountPasswordCredential.findUniqueOrThrow({ where: { accountId: owner.id } });
                expect(Buffer.from(stored.verifierHash).equals(Buffer.from(authKey))).toBe(false);

                const cleared = await app.inject({ method: "DELETE", url: "/v1/account/password", headers: { "x-test-user-id": owner.id } });
                expect(cleared.json()).toEqual({ username: null });
                const afterClear = await post("/v1/auth/password/login", { username: "pigger", authKey: b64(authKey) });
                expect(afterClear.statusCode).toBe(401);
            },
        );
    });

    it("rejects malformed names and keys", async () => {
        await withAuthenticatedTestApp(
            (app) => registerPasswordAuthRoutes(app as any),
            async (app) => {
                const owner = await db.account.create({ data: { publicKey: "pk-password-bad" }, select: { id: true } });
                const params = await app.inject({
                    method: "POST", url: "/v1/auth/password/params",
                    headers: { "content-type": "application/json" }, payload: { username: "a b" },
                });
                expect(params.statusCode).toBe(400);
                const set = await app.inject({
                    method: "POST", url: "/v1/account/password",
                    headers: { "content-type": "application/json", "x-test-user-id": owner.id },
                    payload: { username: "pigger", kdf, authKey: b64(new Uint8Array(31)) + "AAAA", wrappedSecret: b64(new Uint8Array(85)) },
                });
                expect(set.statusCode).toBe(400);
            },
        );
    });
});
