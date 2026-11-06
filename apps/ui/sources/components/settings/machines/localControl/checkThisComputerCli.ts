import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { awaitSystemTaskResult } from '@/components/systemTasks/awaitSystemTaskResult';
import { getSystemTasksRunner } from '@/components/systemTasks/systemTasksRuntime';
import { desktopSetupCoordinator } from '@/setup/desktopSetupCoordinator';

import { buildLocalDaemonServiceSystemTaskSpec } from './buildLocalDaemonServiceSystemTaskSpec';

let inFlight: Promise<void> | null = null;

/**
 * "Is there a newer command line?" for this computer, asked by the desktop app itself: its
 * executor has the installed managed CLI run its own version check (`cli.check.v1`, which
 * downloads nothing), then this computer is read again so its CLI row carries the latest version.
 * It works whatever version that CLI is, so the app learns of a release the CLI's daily check has
 * not reached yet. One check at a time: a call while one runs joins it. Like the app's own
 * background update check, a check that fails keeps the answer already on screen.
 */
export function checkThisComputerCliNow(deps: Readonly<{
    runner?: SystemTaskRunner;
    reread?: () => Promise<unknown>;
}> = {}): Promise<void> {
    const runner = deps.runner ?? getSystemTasksRunner();
    if (runner.mode === 'unavailable') return Promise.resolve();
    if (inFlight) return inFlight;
    const reread = deps.reread ?? (() => desktopSetupCoordinator.inspect({ fresh: true }));
    inFlight = (async () => {
        try {
            const taskId = await runner.start(buildLocalDaemonServiceSystemTaskSpec('cli.check.v1'));
            const result = await awaitSystemTaskResult(runner, taskId);
            if (result.ok) await reread();
        } catch {
            // The row keeps what it showed; the next launch or "check for updates" asks again.
        }
    })().finally(() => {
        inFlight = null;
    });
    return inFlight;
}
