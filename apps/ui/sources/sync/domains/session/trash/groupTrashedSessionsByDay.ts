import { SESSION_TRASH_RETENTION_MS } from '@piggercode/protocol';

import type { Session } from '@/sync/domains/state/storageTypes';

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrashedSessionGroup = Readonly<{
    /** Whole local calendar days between the day the sessions were deleted and today: 0 = today. */
    daysAgo: number;
    sessions: ReadonlyArray<Session>;
}>;

function startOfLocalDayMs(ms: number): number {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole days left before a session deleted at `trashedAt` is deleted for good; 0 once the window has passed (the hourly purge has not run yet). */
export function trashDaysLeft(trashedAt: number, nowMs: number): number {
    return Math.max(0, Math.ceil((trashedAt + SESSION_TRASH_RETENTION_MS - nowMs) / DAY_MS));
}

/** Groups trashed sessions by the local day they were deleted, newest day first and newest deletion first inside a day. */
export function groupTrashedSessionsByDay(sessions: ReadonlyArray<Session>, nowMs: number): TrashedSessionGroup[] {
    const today = startOfLocalDayMs(nowMs);
    const byDay = new Map<number, Session[]>();
    for (const session of sessions) {
        if (typeof session.trashedAt !== 'number') continue;
        const day = startOfLocalDayMs(session.trashedAt);
        const group = byDay.get(day);
        if (group) group.push(session);
        else byDay.set(day, [session]);
    }
    return [...byDay.entries()]
        .sort(([a], [b]) => b - a)
        .map(([day, groupSessions]) => ({
            // Round: a daylight-saving change makes a calendar day 23 or 25 hours long.
            daysAgo: Math.max(0, Math.round((today - day) / DAY_MS)),
            sessions: groupSessions.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0)),
        }));
}
