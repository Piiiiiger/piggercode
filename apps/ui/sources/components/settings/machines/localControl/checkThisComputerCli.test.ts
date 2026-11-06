import { describe, expect, it, vi } from 'vitest';

import { createDeterministicSystemTaskBridge } from '@/components/systemTasks/createDeterministicSystemTaskBridge';
import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { checkThisComputerCliNow } from './checkThisComputerCli';

/** The desktop executor (the native bridge is the boundary), answering every task with `ok`. */
function runnerAnswering(ok: boolean) {
    const kinds: string[] = [];
    const bridge = createDeterministicSystemTaskBridge({
        buildScenario: (spec, taskId) => {
            kinds.push(spec.kind);
            return [{
                delayMs: 0,
                type: 'result',
                payload: ok
                    ? { protocolVersion: 1, taskId, ok: true, data: { version: '0.3.3' } }
                    : { protocolVersion: 1, taskId, ok: false, error: { code: 'cli_check_failed', message: 'getaddrinfo ENOTFOUND api.github.com' } },
            }];
        },
    });
    return { runner: createSystemTaskRunner({ bridge, mode: 'dev' }), kinds };
}

describe('this computer\'s command line, checked by the desktop app', () => {
    it('has the installed CLI look for a newer release, then reads this computer again; a second ask joins the first', async () => {
        const { runner, kinds } = runnerAnswering(true);
        const reread = vi.fn(async () => {});

        await Promise.all([checkThisComputerCliNow({ runner, reread }), checkThisComputerCliNow({ runner, reread })]);

        expect(kinds).toEqual(['cli.check.v1']);
        expect(reread).toHaveBeenCalledTimes(1);
    });

    it('keeps what this computer showed when the check fails', async () => {
        const { runner, kinds } = runnerAnswering(false);
        const reread = vi.fn(async () => {});

        await checkThisComputerCliNow({ runner, reread });

        expect(kinds).toEqual(['cli.check.v1']);
        expect(reread).not.toHaveBeenCalled();
    });
});
