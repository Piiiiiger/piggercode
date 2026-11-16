import { activityCache } from '@/app/presence/sessionCache';
import { trashOwnedSession } from '@/app/session/trash/trashOwnedSession';
import { db } from '@/storage/db';

import { inactiveSessionWhere } from './inactiveSessionWhere';

/** A session nobody has used for this long moves to the trash (回收站) by itself; the owner chose seven days (2026-11-17). */
export const SESSION_AUTO_TRASH_AFTER_DAYS = 7;
const SESSION_AUTO_TRASH_AFTER_MS = SESSION_AUTO_TRASH_AFTER_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

/**
 * Moves every session nobody has used for `SESSION_AUTO_TRASH_AFTER_DAYS` (`inactiveSessionWhere`, archived
 * ones included) to the trash, through the same write and announcements as the Delete action
 * (`trashOwnedSession`). From there it is restored or purged like any other trashed session, and a restore
 * counts as use. The guard repeats the cutoff inside the write, so a session used or reopened between the read
 * and the write stays where it is.
 *
 * The provider copy of a linked session stays in place (only the app moves it, through its machine), so
 * restoring one needs nothing from the machine's own trash.
 */
export async function trashUnusedSessions(params: { now: Date }): Promise<{ trashed: number }> {
    const unused = inactiveSessionWhere(new Date(params.now.getTime() - SESSION_AUTO_TRASH_AFTER_MS));
    let trashed = 0;
    let afterSessionId: string | undefined;
    for (;;) {
        const candidates = await db.session.findMany({
            where: {
                ...unused,
                trashedAt: null,
                ...(afterSessionId ? { id: { gt: afterSessionId } } : null),
            },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            select: { id: true, accountId: true },
        });
        for (const candidate of candidates) {
            if (activityCache.isSessionObservedActive(candidate.id)) continue;
            const result = await trashOwnedSession({
                sessionId: candidate.id,
                ownerAccountId: candidate.accountId,
                sessionWhereGuard: unused,
            });
            if (result.ok) trashed += 1;
        }
        if (candidates.length < BATCH_SIZE) return { trashed };
        afterSessionId = candidates[candidates.length - 1]!.id;
    }
}
