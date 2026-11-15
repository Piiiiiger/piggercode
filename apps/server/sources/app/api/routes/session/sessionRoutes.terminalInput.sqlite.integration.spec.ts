import { randomUUID } from "node:crypto";

import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import { auth } from "@/app/auth/auth";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { sessionRoutes } from "./sessionRoutes";

/**
 * A terminal session stores no message when its owner types a prompt, so before this route only the
 * CLI's own turn reports moved the session's activity, and a runner that reported nothing (one started
 * before those reports existed) left the session dated to its last report however much it was used.
 * These tests run the real route through the real Prisma write, the real list projection and the real
 * update payload; only the socket transport is observed.
 */

const { trackApp, closeTrackedApps } = createAppCloseTracker();

const OLD_ACTIVITY = new Date(1_700_000_000_000);

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // Test-boundary bridge: route helpers use the app-local Fastify alias with auth decorations.
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    sessionRoutes(typed);
    return trackApp(typed);
}

describe("POST /v2/sessions/:sessionId/terminal-input (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-session-terminal-input-sqlite-",
            initAuth: true,
            initEncrypt: false,
            initFiles: false,
        });
    }, 180_000);

    afterEach(async () => {
        vi.restoreAllMocks();
        await closeTrackedApps();
        harness.resetEnv();
        await db.accessKey.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    async function seedAccount() {
        const account = await db.account.create({ data: { publicKey: `pk-${randomUUID()}` }, select: { id: true } });
        return { accountId: account.id, token: await auth.createToken(account.id) };
    }

    async function seedSession(accountId: string) {
        const session = await db.session.create({
            data: {
                accountId,
                tag: `terminal-${randomUUID()}`,
                metadata: "{}",
                meaningfulActivityAt: OLD_ACTIVITY,
            },
            select: { id: true },
        });
        return session.id;
    }

    it("dates the session's activity to when its owner typed, and tells the owner's devices", async () => {
        const app = createTestApp();
        const owner = await seedAccount();
        const sessionId = await seedSession(owner.accountId);
        const emitUpdate = vi.spyOn(eventRouter, "emitUpdate");
        const before = Date.now();

        const response = await app.inject({
            method: "POST",
            url: `/v2/sessions/${sessionId}/terminal-input`,
            headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
            payload: {},
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as { success: boolean; meaningfulActivityAt: number };
        expect(body.success).toBe(true);
        expect(body.meaningfulActivityAt).toBeGreaterThanOrEqual(before);
        expect(body.meaningfulActivityAt).toBeLessThanOrEqual(Date.now());

        // What every list reads: the session row and the list projection carry the new instant.
        const stored = await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { meaningfulActivityAt: true } });
        expect(stored.meaningfulActivityAt?.getTime()).toBe(body.meaningfulActivityAt);
        const list = await app.inject({
            method: "GET",
            url: "/v2/sessions?limit=10",
            headers: { authorization: `Bearer ${owner.token}` },
        });
        const listed = (list.json() as { sessions: Array<{ id: string; meaningfulActivityAt: number }> }).sessions
            .find((session) => session.id === sessionId);
        expect(listed?.meaningfulActivityAt).toBe(body.meaningfulActivityAt);

        // Devices that already list the session learn it at once.
        expect(emitUpdate).toHaveBeenCalledTimes(1);
        expect(emitUpdate).toHaveBeenCalledWith(expect.objectContaining({
            userId: owner.accountId,
            recipientFilter: { type: "all-interested-in-session", sessionId },
            payload: expect.objectContaining({
                body: expect.objectContaining({
                    t: "update-session",
                    id: sessionId,
                    meaningfulActivityAt: body.meaningfulActivityAt,
                }),
            }),
        }));
    });

    it("does not let another account date the session", async () => {
        const app = createTestApp();
        const owner = await seedAccount();
        const stranger = await seedAccount();
        const sessionId = await seedSession(owner.accountId);
        const emitUpdate = vi.spyOn(eventRouter, "emitUpdate");

        const response = await app.inject({
            method: "POST",
            url: `/v2/sessions/${sessionId}/terminal-input`,
            headers: { authorization: `Bearer ${stranger.token}`, "content-type": "application/json" },
            payload: {},
        });

        expect(response.statusCode).toBe(403);
        const stored = await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { meaningfulActivityAt: true } });
        expect(stored.meaningfulActivityAt?.getTime()).toBe(OLD_ACTIVITY.getTime());
        expect(emitUpdate).not.toHaveBeenCalled();
    });

    it("answers 404 for a session that does not exist", async () => {
        const app = createTestApp();
        const owner = await seedAccount();

        const response = await app.inject({
            method: "POST",
            url: `/v2/sessions/${randomUUID()}/terminal-input`,
            headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
            payload: {},
        });

        expect(response.statusCode).toBe(404);
    });
});
