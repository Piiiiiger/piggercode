import type { Prisma } from "@prisma/client";

import { didSessionActivityBadgeContributionChange } from "@/app/activity/accountActivityBadge";
import { refreshSessionParticipantBadgePushes } from "@/app/activity/refreshAccountActivityBadgePushes";
import { invalidateSessionRelayAuthorizationForSession } from "@/app/api/socket/sessionRelayAuthCache";
import { markSessionParticipantsChanged } from "@/app/session/changeTracking/markSessionParticipantsChanged";
import { emitSessionDeletedUpdate } from "@/app/session/delete/emitSessionDeletedUpdate";
import { inTx } from "@/storage/inTx";

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

export type TrashOwnedSessionResult =
    | Readonly<{ ok: true; trashedAt: number }>
    | Readonly<{ ok: false; error: "not-found" | "session-active" }>;

/**
 * Moves an owner's session to the trash (回收站): the Delete action (`POST /v2/sessions/:id/trash`) and the
 * hourly move of sessions nobody has used (`retention/rules/sessionAutoTrashRule.ts`) both go through here.
 * A trashed session is hidden from every list; other devices learn of it through the same signals a hard
 * delete uses (the account change cursor, then a user-scoped `delete-session`). Repeating it changes and
 * announces nothing.
 *
 * One conditional write: a runner that registered since the caller stopped the session makes it match
 * nothing, so a session that is running is never trashed from under its runner (`session-active`). The
 * same holds for `sessionWhereGuard`, the caller's own conditions, which the session must still meet at the write.
 */
export async function trashOwnedSession(params: Readonly<{
    sessionId: string;
    ownerAccountId: string;
    sessionWhereGuard?: Prisma.SessionWhereInput;
}>): Promise<TrashOwnedSessionResult> {
    const { sessionId, ownerAccountId } = params;

    const res = await inTx(async (tx) => {
        const session = await tx.session.findFirst({
            where: { id: sessionId, accountId: ownerAccountId },
            select: SESSION_BADGE_INPUT_SELECT,
        });
        if (!session) return { ok: false as const, error: "not-found" as const };
        if (session.trashedAt) {
            return { ok: true as const, trashedAt: session.trashedAt.getTime(), participantCursors: [], badgeAttentionChanged: false };
        }

        const trashedAt = new Date();
        const moved = await tx.session.updateMany({
            where: { ...params.sessionWhereGuard, id: sessionId, accountId: ownerAccountId, trashedAt: null, active: false },
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

    if (!res.ok) return res;

    // Cached relay publish authorizations must not outlive the session's availability.
    invalidateSessionRelayAuthorizationForSession(sessionId);
    await refreshSessionParticipantBadgePushes({
        badgeAttentionChanged: res.badgeAttentionChanged,
        participantCursors: res.participantCursors,
    });
    await Promise.all(res.participantCursors.map(({ accountId, cursor }) => (
        emitSessionDeletedUpdate({ sessionId, accountId, cursor })
    )));
    return { ok: true, trashedAt: res.trashedAt };
}
