import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activityCache } from '@/app/presence/sessionCache';
import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('purgeExpiredTrashedSessions', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: 'retention-session-trash-purge-' });
    });

    afterAll(async () => {
        activityCache.shutdown();
        await harness.close();
    });

    beforeEach(async () => {
        activityCache.shutdown();
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.sessionShare.deleteMany(),
            () => db.accountChange.deleteMany(),
            () => db.sessionMessage.deleteMany(),
            () => db.session.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it('deletes sessions trashed more than 7 days ago and leaves younger and untrashed ones, with the retention policy off', async () => {
        const now = new Date('2026-11-20T00:00:00.000Z');
        await db.account.create({ data: { id: 'owner' } });
        const old = new Date(now.getTime() - 8 * DAY_MS);
        const recent = new Date(now.getTime() - 6 * DAY_MS);
        await db.session.createMany({
            data: [
                { id: 'expired', tag: 'expired', accountId: 'owner', metadata: '{}', active: false, trashedAt: old },
                { id: 'young', tag: 'young', accountId: 'owner', metadata: '{}', active: false, trashedAt: recent },
                // Old and inactive but never trashed: only the general retention policy may touch it.
                { id: 'untrashed', tag: 'untrashed', accountId: 'owner', metadata: '{}', active: false, updatedAt: old, lastActiveAt: old },
            ],
        });
        await db.sessionMessage.create({
            data: { sessionId: 'expired', seq: 1, content: { t: 'plain', v: { role: 'user', text: 'hi' } } },
        });

        const { purgeExpiredTrashedSessions } = await import('./sessionTrashPurgeRule');
        const result = await purgeExpiredTrashedSessions({ now });

        expect(result).toEqual({ deleted: 1 });
        expect(await db.session.findUnique({ where: { id: 'expired' } })).toBeNull();
        expect(await db.sessionMessage.count({ where: { sessionId: 'expired' } })).toBe(0);
        expect(await db.session.findUnique({ where: { id: 'young' } })).not.toBeNull();
        expect(await db.session.findUnique({ where: { id: 'untrashed' } })).not.toBeNull();
    });

    it('keeps a session that was restored (trashedAt cleared) even though it was trashed long ago', async () => {
        const now = new Date('2026-11-20T00:00:00.000Z');
        await db.account.create({ data: { id: 'owner' } });
        await db.session.create({
            data: { id: 'restored', tag: 'restored', accountId: 'owner', metadata: '{}', active: false, trashedAt: null },
        });
        const { purgeExpiredTrashedSessions } = await import('./sessionTrashPurgeRule');
        expect(await purgeExpiredTrashedSessions({ now })).toEqual({ deleted: 0 });
        expect(await db.session.findUnique({ where: { id: 'restored' } })).not.toBeNull();
    });
});
