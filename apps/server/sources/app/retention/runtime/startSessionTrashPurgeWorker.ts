import { error as logError, log } from '@/utils/logging/log';
import { purgeExpiredTrashedSessions } from '@/app/retention/rules/sessionTrashPurgeRule';

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Purges expired trash (回收站) at start and then hourly. It is part of the trash feature, not of the
 * optional retention policy, so it runs whether or not `PIGGERCODE_SERVER_RETENTION__ENABLED` is set and
 * never reads or changes that policy.
 */
export function startSessionTrashPurgeWorker(): { stop: () => void } {
    let stopped = false;
    let running = false;

    const run = async (reason: 'startup' | 'interval') => {
        if (running || stopped) return;
        running = true;
        try {
            const { deleted } = await purgeExpiredTrashedSessions({ now: new Date() });
            if (deleted > 0) {
                log({ module: 'session-trash-purge', reason, deleted }, `Purged ${deleted} expired trashed session(s)`);
            }
        } catch (error) {
            logError(
                { module: 'session-trash-purge', reason, error: error instanceof Error ? error.message : String(error) },
                `Session trash purge failed (${reason})`,
            );
        } finally {
            running = false;
        }
    };

    void run('startup');
    const timer = setInterval(() => {
        void run('interval');
    }, PURGE_INTERVAL_MS);
    timer.unref?.();

    return {
        stop: () => {
            stopped = true;
            clearInterval(timer);
        },
    };
}
