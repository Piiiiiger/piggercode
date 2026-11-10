import { SESSION_TRASH_RETENTION_MS } from '@piggercode/protocol';

import { db } from '@/storage/db';
import { deleteOwnedSession } from '@/app/session/delete/deleteOwnedSession';

const PURGE_BATCH_SIZE = 100;

/**
 * Hard-deletes sessions that have sat in the trash for `SESSION_TRASH_RETENTION_DAYS`, through the shared
 * delete flow (`deleteOwnedSession`, reason `retention_policy`). Untrashed sessions are never candidates:
 * the cutoff is on `trashedAt` alone. The guard repeats the cutoff inside the delete, so a session restored
 * between the read and the delete is left alone.
 */
export async function purgeExpiredTrashedSessions(params: { now: Date }): Promise<{ deleted: number }> {
    const cutoff = new Date(params.now.getTime() - SESSION_TRASH_RETENTION_MS);
    let deleted = 0;
    let afterSessionId: string | undefined;
    for (;;) {
        const candidates = await db.session.findMany({
            where: {
                trashedAt: { lt: cutoff },
                ...(afterSessionId ? { id: { gt: afterSessionId } } : null),
            },
            orderBy: { id: 'asc' },
            take: PURGE_BATCH_SIZE,
            select: { id: true },
        });
        for (const candidate of candidates) {
            const ok = await deleteOwnedSession({
                sessionId: candidate.id,
                reason: 'retention_policy',
                sessionWhereGuard: { trashedAt: { lt: cutoff } },
            });
            if (ok) deleted += 1;
        }
        if (candidates.length < PURGE_BATCH_SIZE) return { deleted };
        afterSessionId = candidates[candidates.length - 1]!.id;
    }
}
