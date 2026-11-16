import type { Prisma } from '@prisma/client';

/**
 * Sessions nobody has used since `cutoff`: no runner holds them, and both the row and the runner's last
 * heartbeat are older. Every use writes the row (a message, typing in its terminal, a queued message, a rename,
 * reading new messages, a stop, a restore from the trash), so `updatedAt` is when it was last used, and
 * `lastActiveAt` keeps a session that sat open in its terminal from counting as unused.
 *
 * Callers also skip sessions `activityCache.isSessionObservedActive` reports: a runner whose heartbeat is not
 * written yet. Both the inactive-session retention policy and the move of unused sessions to the trash read this.
 */
export function inactiveSessionWhere(cutoff: Date) {
    return {
        active: false,
        updatedAt: { lt: cutoff },
        lastActiveAt: { lt: cutoff },
    } satisfies Prisma.SessionWhereInput;
}
