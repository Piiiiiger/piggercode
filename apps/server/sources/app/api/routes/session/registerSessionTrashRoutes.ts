import { z } from "zod";

import { didSessionActivityBadgeContributionChange } from "@/app/activity/accountActivityBadge";
import { refreshSessionParticipantBadgePushes } from "@/app/activity/refreshAccountActivityBadgePushes";
import { buildNewSessionUpdate, eventRouter } from "@/app/events/eventRouter";
import { invalidateSessionRelayAuthorizationForSession } from "@/app/api/socket/sessionRelayAuthCache";
import { markSessionParticipantsChanged } from "@/app/session/changeTracking/markSessionParticipantsChanged";
import { emitSessionDeletedUpdate } from "@/app/session/delete/emitSessionDeletedUpdate";
import { inTx } from "@/storage/inTx";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import { type Fastify } from "../../types";
import { mapStoredSessionRuntimeActivityProjection } from "./v2SessionListRows";

const SESSION_BADGE_INPUT_SELECT = {
    seq: true,
    pendingCount: true,
    pendingBlockedCount: true,
    lastViewedSessionSeq: true,
    pendingPermissionRequestCount: true,
    pendingUserActionRequestCount: true,
    latestTurnStatus: true,
    lastRuntimeIssue: true,
    active: true,
    archivedAt: true,
    trashedAt: true,
} as const;

/**
 * Trash (回收站): deleting a session moves it here first; `GET /v2/sessions/trash` lists it, restoring puts
 * it back, and the purge rule (`retention/rules/sessionTrashPurgeRule.ts`) deletes it for good after
 * `SESSION_TRASH_RETENTION_DAYS`. Only the owner trashes or restores; a hard delete stays `DELETE /v1/sessions/:id`.
 *
 * A trashed session is hidden from every list by the `trashedAt: null` conjunct that sits beside each
 * `archivedAt` one. Other devices learn of it through the same signals a hard delete uses (the account
 * change cursor, then a user-scoped `delete-session`); restoring is announced with `new-session`, which
 * makes a client fetch its lists again. Both are idempotent: repeating one changes and announces nothing.
 */
export function registerSessionTrashRoutes(app: Fastify) {
    app.post("/v2/sessions/:sessionId/trash", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ sessionId: z.string() }),
            response: {
                200: z.object({ success: z.literal(true), trashedAt: z.number() }),
                404: z.object({ error: z.literal("Session not found") }),
                409: z.object({ error: z.literal("session-active") }),
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const res = await inTx(async (tx) => {
            const session = await tx.session.findFirst({
                where: { id: sessionId, accountId: userId },
                select: SESSION_BADGE_INPUT_SELECT,
            });
            if (!session) return { ok: false as const, error: "not-found" as const };
            if (session.trashedAt) {
                return { ok: true as const, trashedAt: session.trashedAt.getTime(), participantCursors: [], badgeAttentionChanged: false };
            }

            // One conditional write: a runner that registered since the caller stopped the session makes it
            // match nothing, so a session that is running is never trashed from under its runner.
            const trashedAt = new Date();
            const moved = await tx.session.updateMany({
                where: { id: sessionId, accountId: userId, trashedAt: null, active: false },
                data: { trashedAt },
            });
            if (moved.count !== 1) return { ok: false as const, error: "session-active" as const };

            const participantCursors = await markSessionParticipantsChanged({ tx, sessionId });
            return {
                ok: true as const,
                trashedAt: trashedAt.getTime(),
                participantCursors,
                badgeAttentionChanged: didSessionActivityBadgeContributionChange(session, { ...session, trashedAt }),
            };
        });

        if (!res.ok) {
            return res.error === "session-active"
                ? reply.code(409).send({ error: "session-active" })
                : reply.code(404).send({ error: "Session not found" });
        }

        // Cached relay publish authorizations must not outlive the session's availability.
        invalidateSessionRelayAuthorizationForSession(sessionId);
        await refreshSessionParticipantBadgePushes({
            badgeAttentionChanged: res.badgeAttentionChanged,
            participantCursors: res.participantCursors,
        });
        await Promise.all(res.participantCursors.map(({ accountId, cursor }) => (
            emitSessionDeletedUpdate({ sessionId, accountId, cursor })
        )));
        return reply.send({ success: true, trashedAt: res.trashedAt });
    });

    app.post("/v2/sessions/:sessionId/restore", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ sessionId: z.string() }),
            response: {
                200: z.object({ success: z.literal(true), trashedAt: z.null() }),
                404: z.object({ error: z.literal("Session not found") }),
            },
        },
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const res = await inTx(async (tx) => {
            const session = await tx.session.findFirst({
                where: { id: sessionId, accountId: userId },
            });
            if (!session) return { ok: false as const };
            if (!session.trashedAt) {
                return { ok: true as const, session: null, participantCursors: [], badgeAttentionChanged: false };
            }

            await tx.session.update({ where: { id: sessionId }, data: { trashedAt: null } });
            const participantCursors = await markSessionParticipantsChanged({ tx, sessionId });
            return {
                ok: true as const,
                session,
                participantCursors,
                badgeAttentionChanged: didSessionActivityBadgeContributionChange(session, { ...session, trashedAt: null }),
            };
        });

        if (!res.ok) {
            return reply.code(404).send({ error: "Session not found" });
        }

        await refreshSessionParticipantBadgePushes({
            badgeAttentionChanged: res.badgeAttentionChanged,
            participantCursors: res.participantCursors,
        });
        const restored = res.session;
        if (restored) {
            const runtimeActivityProjection = mapStoredSessionRuntimeActivityProjection(restored);
            for (const { accountId, cursor } of res.participantCursors) {
                eventRouter.emitUpdate({
                    userId: accountId,
                    payload: buildNewSessionUpdate({
                        id: restored.id,
                        seq: restored.seq,
                        metadata: restored.metadata,
                        metadataVersion: restored.metadataVersion,
                        agentState: restored.agentState,
                        agentStateVersion: restored.agentStateVersion,
                        dataEncryptionKey: restored.dataEncryptionKey,
                        active: restored.active,
                        lastActiveAt: restored.lastActiveAt,
                        createdAt: restored.createdAt,
                        updatedAt: restored.updatedAt,
                        meaningfulActivityAt: restored.meaningfulActivityAt,
                        ...runtimeActivityProjection,
                    }, cursor, randomKeyNaked(12)),
                    recipientFilter: { type: "user-scoped-only" },
                });
            }
        }
        return reply.send({ success: true, trashedAt: null });
    });
}
