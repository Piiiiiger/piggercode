import { z } from "zod";

import { buildUpdateSessionUpdate, eventRouter } from "@/app/events/eventRouter";
import { recordSessionTerminalInput } from "@/app/session/sessionWriteService";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import { type Fastify } from "../../types";

/**
 * An app tells the relay that its user typed into a session's terminal; the session's activity is
 * dated to it and every device listing the session is told at once (the 「最近」 box, the list order
 * and each row's time follow it).
 */
export function registerSessionTerminalInputRoute(app: Fastify) {
    app.post("/v2/sessions/:sessionId/terminal-input", {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ sessionId: z.string() }),
            response: {
                200: z.object({
                    success: z.literal(true),
                    meaningfulActivityAt: z.number(),
                }),
                400: z.object({ error: z.literal("invalid-params") }),
                403: z.object({ error: z.literal("Forbidden") }),
                404: z.object({ error: z.literal("Session not found") }),
                500: z.object({ error: z.literal("Failed to record terminal input") }),
            },
        },
    }, async (request, reply) => {
        const { sessionId } = request.params;
        const result = await recordSessionTerminalInput({ actorUserId: request.userId, sessionId });

        if (!result.ok) {
            if (result.error === "invalid-params") return reply.code(400).send({ error: "invalid-params" });
            if (result.error === "forbidden") return reply.code(403).send({ error: "Forbidden" });
            if (result.error === "session-not-found") return reply.code(404).send({ error: "Session not found" });
            return reply.code(500).send({ error: "Failed to record terminal input" });
        }

        for (const { accountId, cursor } of result.participantCursors) {
            eventRouter.emitUpdate({
                userId: accountId,
                payload: buildUpdateSessionUpdate(
                    sessionId,
                    cursor,
                    randomKeyNaked(12),
                    undefined,
                    undefined,
                    { meaningfulActivityAt: result.meaningfulActivityAt },
                ),
                recipientFilter: { type: "all-interested-in-session", sessionId },
            });
        }

        return reply.send({ success: true as const, meaningfulActivityAt: result.meaningfulActivityAt });
    });
}
