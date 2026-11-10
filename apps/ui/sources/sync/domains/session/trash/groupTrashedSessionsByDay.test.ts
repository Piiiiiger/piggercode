import { describe, expect, it } from 'vitest';

import type { Session } from '@/sync/domains/state/storageTypes';

import { groupTrashedSessionsByDay, trashDaysLeft } from './groupTrashedSessionsByDay';

const DAY_MS = 24 * 60 * 60 * 1000;
const trashed = (id: string, trashedAt: number) => ({ id, trashedAt }) as unknown as Session;

describe('groupTrashedSessionsByDay', () => {
    const now = new Date(2026, 10, 8, 15, 0, 0).getTime();

    it('groups by local deletion day, newest day first and newest deletion first inside a day', () => {
        const groups = groupTrashedSessionsByDay([
            trashed('old', new Date(2026, 10, 5, 23, 59).getTime()),
            trashed('today-early', new Date(2026, 10, 8, 0, 1).getTime()),
            trashed('yesterday', new Date(2026, 10, 7, 23, 59).getTime()),
            trashed('today-late', new Date(2026, 10, 8, 14, 0).getTime()),
        ], now);

        expect(groups.map((g) => [g.daysAgo, g.sessions.map((s) => s.id)])).toEqual([
            [0, ['today-late', 'today-early']],
            [1, ['yesterday']],
            [3, ['old']],
        ]);
    });

    it('counts the days left of the 7-day window and reaches 0 once it has passed', () => {
        expect(trashDaysLeft(now, now)).toBe(7);
        expect(trashDaysLeft(now - 2 * DAY_MS, now)).toBe(5);
        expect(trashDaysLeft(now - 7 * DAY_MS + 1000, now)).toBe(1);
        expect(trashDaysLeft(now - 7 * DAY_MS - 1000, now)).toBe(0);
    });
});
