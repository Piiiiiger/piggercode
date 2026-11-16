import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { activityCache } from '@/app/presence/sessionCache';
import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';

const emitUpdate = vi.fn();
vi.mock('@/app/events/eventRouter', async () => {
    const actual = await vi.importActual<typeof import('@/app/events/eventRouter')>('@/app/events/eventRouter');
    return {
        ...actual,
        eventRouter: {
            ...actual.eventRouter,
            emitUpdate,
        },
    };
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('trashUnusedSessions', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'retention-session-auto-trash-' });
    });

    afterAll(async () => {
        activityCache.shutdown();
        await harness.close();
    });

    beforeEach(async () => {
        emitUpdate.mockReset();
        activityCache.shutdown();
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.session.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it('moves sessions nobody has used for 7 days to the trash and tells the owner, leaving newer, running and trashed ones', async () => {
        const now = new Date();
        const unused = new Date(now.getTime() - 8 * DAY_MS);
        const recent = new Date(now.getTime() - 6 * DAY_MS);
        const trashedEarlier = new Date(now.getTime() - 3 * DAY_MS);
        await db.account.create({ data: { id: 'owner' } });
        const base = { accountId: 'owner', metadata: '{}', active: false };
        await db.session.createMany({
            data: [
                { ...base, id: 'unused', tag: 'unused', updatedAt: unused, lastActiveAt: unused },
                { ...base, id: 'unused-archived', tag: 'unused-archived', archivedAt: unused, updatedAt: unused, lastActiveAt: unused },
                { ...base, id: 'recent', tag: 'recent', updatedAt: recent, lastActiveAt: recent },
                { ...base, id: 'running', tag: 'running', active: true, updatedAt: unused, lastActiveAt: unused },
                { ...base, id: 'in-trash', tag: 'in-trash', trashedAt: trashedEarlier, updatedAt: unused, lastActiveAt: unused },
            ],
        });

        const { trashUnusedSessions } = await import('./sessionAutoTrashRule');
        expect(await trashUnusedSessions({ now })).toEqual({ trashed: 2 });

        const trashedAt = async (id: string) => (await db.session.findUniqueOrThrow({ where: { id } })).trashedAt;
        expect(await trashedAt('unused')).not.toBeNull();
        expect(await trashedAt('unused-archived')).not.toBeNull();
        expect(await trashedAt('recent')).toBeNull();
        expect(await trashedAt('running')).toBeNull();
        expect(await trashedAt('in-trash')).toEqual(trashedEarlier);

        // The owner's devices drop them from their lists the way they do for the Delete action.
        const deletedSessionIds = emitUpdate.mock.calls
            .map(([update]) => update as { userId: string; payload: { body: { t: string; sid?: string } } })
            .filter((update) => update.userId === 'owner' && update.payload.body.t === 'delete-session')
            .map((update) => update.payload.body.sid)
            .sort();
        expect(deletedSessionIds).toEqual(['unused', 'unused-archived']);

        // A second pass finds nothing more to move.
        expect(await trashUnusedSessions({ now })).toEqual({ trashed: 0 });
    });
});
