import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import { auth } from "@/app/auth/auth";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { sessionRoutes } from "./sessionRoutes";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    sessionRoutes(typed);
    return trackApp(typed);
}

describe("session trash (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "piggercode-session-trash-sqlite-",
            initAuth: true,
            initEncrypt: true,
        });
    }, 120_000);

    afterEach(async () => {
        await closeTrackedApps();
        harness.resetEnv();
        await db.sessionShare.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    async function createOwnerWithSession(extra: { archivedAt?: Date } = {}) {
        const owner = await db.account.create({ data: { publicKey: `pk-${randomUUID()}` } });
        const token = await auth.createToken(owner.id);
        const sessionId = `s-${randomUUID()}`;
        await db.session.create({
            data: { id: sessionId, tag: sessionId, accountId: owner.id, metadata: "{}", active: false, ...extra },
        });
        return { owner, token, sessionId, headers: { authorization: `Bearer ${token}` } };
    }

    async function listIds(app: ReturnType<typeof createTestApp>, url: string, headers: Record<string, string>) {
        const res = await app.inject({ method: "GET", url, headers });
        expect(res.statusCode).toBe(200);
        return (res.json().sessions as Array<{ id: string }>).map((session) => session.id);
    }

    it("hides a trashed session from every list and shows it only in the trash list; restore puts it back unchanged", async () => {
        const app = createTestApp();
        const { owner, sessionId, headers } = await createOwnerWithSession();
        const archivedSession = { sessionId: `s-${randomUUID()}` };
        await db.session.create({
            data: { id: archivedSession.sessionId, tag: archivedSession.sessionId, accountId: owner.id, metadata: "{}", active: false, archivedAt: new Date(1_000) },
        });

        expect(await listIds(app, "/v2/sessions", headers)).toEqual([sessionId]);
        expect(await listIds(app, "/v2/sessions/archived", headers)).toEqual([archivedSession.sessionId]);

        const trashed = await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers });
        expect(trashed.statusCode).toBe(200);
        const { trashedAt } = trashed.json();
        expect(trashedAt).toBeGreaterThan(0);
        const trashedArchived = await app.inject({ method: "POST", url: `/v2/sessions/${archivedSession.sessionId}/trash`, headers });
        expect(trashedArchived.statusCode).toBe(200);

        expect(await listIds(app, "/v2/sessions", headers)).toEqual([]);
        expect(await listIds(app, "/v2/sessions/archived", headers)).toEqual([]);
        expect((await app.inject({ method: "GET", url: "/v1/sessions", headers })).json().sessions).toEqual([]);
        expect((await app.inject({ method: "GET", url: `/v2/sessions/${sessionId}`, headers })).statusCode).toBe(404);
        const trashList = await app.inject({ method: "GET", url: "/v2/sessions/trash", headers });
        expect(trashList.statusCode).toBe(200);
        expect(trashList.json().sessions.map((s: { id: string; trashedAt: number }) => [s.id, typeof s.trashedAt]).sort())
            .toEqual([[sessionId, "number"], [archivedSession.sessionId, "number"]].sort());

        // Trashing again changes nothing (idempotent): the original instant stays.
        const again = await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers });
        expect(again.json()).toEqual({ success: true, trashedAt });

        for (const id of [sessionId, archivedSession.sessionId]) {
            const restored = await app.inject({ method: "POST", url: `/v2/sessions/${id}/restore`, headers });
            expect(restored.json()).toEqual({ success: true, trashedAt: null });
        }
        expect(await listIds(app, "/v2/sessions", headers)).toEqual([sessionId]);
        expect(await listIds(app, "/v2/sessions/archived", headers)).toEqual([archivedSession.sessionId]);
        expect(await listIds(app, "/v2/sessions/trash", headers)).toEqual([]);
        const restoredRow = await db.session.findUniqueOrThrow({ where: { id: archivedSession.sessionId } });
        expect(restoredRow.archivedAt).toEqual(new Date(1_000));
        expect(restoredRow.trashedAt).toBeNull();
    });

    it("only the owner can trash or restore, and a hard delete still removes a trashed session", async () => {
        const app = createTestApp();
        const { sessionId, headers } = await createOwnerWithSession();
        const other = await db.account.create({ data: { publicKey: `pk-${randomUUID()}` } });
        const otherHeaders = { authorization: `Bearer ${await auth.createToken(other.id)}` };

        const foreign = await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers: otherHeaders });
        expect(foreign.statusCode).toBe(404);
        expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).trashedAt).toBeNull();

        expect((await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers })).statusCode).toBe(200);
        expect((await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/restore`, headers: otherHeaders })).statusCode).toBe(404);
        expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).trashedAt).not.toBeNull();

        const deleted = await app.inject({ method: "DELETE", url: `/v1/sessions/${sessionId}`, headers });
        expect(deleted.statusCode).toBe(200);
        expect(await db.session.findUnique({ where: { id: sessionId } })).toBeNull();
    });

    it("hides a trashed session from a user it is shared with", async () => {
        const app = createTestApp();
        const { owner, sessionId, headers } = await createOwnerWithSession();
        const friend = await db.account.create({ data: { publicKey: `pk-${randomUUID()}` } });
        const friendHeaders = { authorization: `Bearer ${await auth.createToken(friend.id)}` };
        await db.sessionShare.create({ data: { sessionId, sharedByUserId: owner.id, sharedWithUserId: friend.id } });
        expect(await listIds(app, "/v2/sessions", friendHeaders)).toEqual([sessionId]);

        await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers });
        expect(await listIds(app, "/v2/sessions", friendHeaders)).toEqual([]);
        // Only the owner's trash list shows it.
        expect(await listIds(app, "/v2/sessions/trash", friendHeaders)).toEqual([]);
    });

    it("refuses to trash a running session and never revives a trashed one by its tag or through access checks", async () => {
        const app = createTestApp();
        const { owner, sessionId, headers } = await createOwnerWithSession();
        await db.session.update({ where: { id: sessionId }, data: { active: true } });

        const refused = await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers });
        expect(refused.statusCode).toBe(409);
        expect(refused.json()).toEqual({ error: "session-active" });
        expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).trashedAt).toBeNull();

        await db.session.update({ where: { id: sessionId }, data: { active: false } });
        expect((await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/trash`, headers })).statusCode).toBe(200);

        const tag = (await db.session.findUniqueOrThrow({ where: { id: sessionId } })).tag;
        const reload = await app.inject({
            method: "POST",
            url: "/v1/sessions",
            headers,
            payload: { tag, metadata: "{}", encryptionMode: "e2ee" },
        });
        expect(reload.statusCode).toBe(409);
        expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).trashedAt).not.toBeNull();

        const { enqueuePendingMessage } = await import("@/app/session/pending/pendingMessageService");
        expect(await enqueuePendingMessage({
            actorUserId: owner.id,
            sessionId,
            localId: "pending-1",
            ciphertext: "ciphertext",
            requestedAction: { v: 1, kind: "enqueue" },
        })).toEqual({ ok: false, error: "session-not-found" });
        expect(await db.sessionPendingMessage.count({ where: { sessionId } })).toBe(0);

        const { checkSessionAccess } = await import("@/app/share/accessControl");
        expect(await checkSessionAccess(owner.id, sessionId)).toBeNull();
        await app.inject({ method: "POST", url: `/v2/sessions/${sessionId}/restore`, headers });
        expect(await checkSessionAccess(owner.id, sessionId)).not.toBeNull();
    });
});
