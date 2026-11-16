import { error as logError, log } from '@/utils/logging/log';
import { trashUnusedSessions } from '@/app/retention/rules/sessionAutoTrashRule';
import { purgeExpiredTrashedSessions } from '@/app/retention/rules/sessionTrashPurgeRule';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Keeps the trash (回收站) at start and then hourly: sessions nobody has used for `SESSION_AUTO_TRASH_AFTER_DAYS`
 * move into it, and sessions that have sat in it for `SESSION_TRASH_RETENTION_DAYS` are deleted for good. It is
 * part of the trash feature, not of the optional retention policy, so it runs whether or not
 * `PIGGERCODE_SERVER_RETENTION__ENABLED` is set and never reads or changes that policy. Each step logs its own
 * failure and the other still runs; the next hour tries again.
 */
export function startSessionTrashWorker(): { stop: () => void } {
    let stopped = false;
    let running = false;

    const step = async (name: 'auto-trash' | 'purge', reason: 'startup' | 'interval', work: () => Promise<number>) => {
        try {
            const count = await work();
            if (count > 0) {
                log(
                    { module: 'session-trash', step: name, reason, count },
                    name === 'auto-trash'
                        ? `Moved ${count} unused session(s) to the trash`
                        : `Purged ${count} expired trashed session(s)`,
                );
            }
        } catch (error) {
            logError(
                { module: 'session-trash', step: name, reason, error: error instanceof Error ? error.message : String(error) },
                `Session trash ${name} failed (${reason})`,
            );
        }
    };

    const run = async (reason: 'startup' | 'interval') => {
        if (running || stopped) return;
        running = true;
        try {
            const now = new Date();
            await step('auto-trash', reason, async () => (await trashUnusedSessions({ now })).trashed);
            await step('purge', reason, async () => (await purgeExpiredTrashedSessions({ now })).deleted);
        } finally {
            running = false;
        }
    };

    void run('startup');
    const timer = setInterval(() => {
        void run('interval');
    }, INTERVAL_MS);
    timer.unref?.();

    return {
        stop: () => {
            stopped = true;
            clearInterval(timer);
        },
    };
}
