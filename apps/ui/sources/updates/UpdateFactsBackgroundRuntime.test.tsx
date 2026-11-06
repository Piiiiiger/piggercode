import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import type { Machine } from '@/sync/domains/state/storageTypes';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { useRereadThisComputerWhenItsDaemonDisagrees } from './UpdateFactsBackgroundRuntime';

function machineWithLatest(id: string, latestVersion: string): Machine {
    const machine = createMachineFixture({ id });
    return {
        ...machine,
        metadata: {
            ...machine.metadata!,
            cliUpdate: {
                currentVersion: '0.3.4', latestVersion, channel: 'stable', installSource: 'managed',
                updateCommand: 'piggercode self update', canUpdateRemotely: true, lastUpdate: null,
            },
        },
    };
}

type Props = Readonly<{ machines: Machine[]; inspectedLatest: string }>;

describe('this computer follows the CLI facts its daemon publishes', () => {
    it('reads this computer again while the inspection is behind its daemon, once per disagreement', async () => {
        const reread = vi.fn();
        const hook = await renderHook(
            (props: Props) => useRereadThisComputerWhenItsDaemonDisagrees({
                enabled: true,
                machineId: 'mac',
                inspected: { currentVersion: '0.3.4', latestVersion: props.inspectedLatest },
                machines: props.machines,
                reread,
            }),
            // Read before the daemon's version check found 0.3.5, which its first published facts carry.
            { initialProps: { machines: [machineWithLatest('mac', '0.3.5'), machineWithLatest('server', '0.3.4')], inspectedLatest: '0.3.4' } },
        );
        expect(reread).toHaveBeenCalledTimes(1);

        // The same disagreement again (the re-read has not answered yet) asks nothing more.
        await hook.rerender({ machines: [machineWithLatest('mac', '0.3.5'), machineWithLatest('server', '0.3.5')], inspectedLatest: '0.3.4' });
        expect(reread).toHaveBeenCalledTimes(1);

        // The re-read caught up; another machine's facts are not this computer's.
        await hook.rerender({ machines: [machineWithLatest('mac', '0.3.5'), machineWithLatest('server', '0.3.6')], inspectedLatest: '0.3.5' });
        expect(reread).toHaveBeenCalledTimes(1);

        // The daemon's next check found 0.3.6.
        await hook.rerender({ machines: [machineWithLatest('mac', '0.3.6'), machineWithLatest('server', '0.3.6')], inspectedLatest: '0.3.5' });
        expect(reread).toHaveBeenCalledTimes(2);
    });

    it('asks nothing while the inspection and the daemon agree', async () => {
        const reread = vi.fn();
        await renderHook(() => useRereadThisComputerWhenItsDaemonDisagrees({
            enabled: true,
            machineId: 'mac',
            inspected: { currentVersion: '0.3.4', latestVersion: '0.3.5' },
            machines: [machineWithLatest('mac', '0.3.5')],
            reread,
        }));
        expect(reread).not.toHaveBeenCalled();
    });
});
