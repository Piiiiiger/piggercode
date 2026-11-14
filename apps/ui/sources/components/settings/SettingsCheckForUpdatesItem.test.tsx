import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { invokeTestInstanceHandler, renderScreen } from '@/dev/testkit';
import type { UpdateItem } from '@/updates/items/updateItem';

import { CheckForUpdatesItem } from './SettingsCheckForUpdatesItem';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

function appItem(overrides: Partial<UpdateItem>): UpdateItem {
    return {
        id: 'app', subject: { kind: 'app' }, machineId: null, title: 'PiggerCode',
        currentVersion: '0.3.6', latestVersion: null, state: 'upToDate', progressPercent: null, step: null,
        managedBy: 'happier', action: { kind: 'none' }, failure: null, skipped: false,
        ...overrides,
    } as UpdateItem;
}

async function renderRow(item: UpdateItem) {
    const run = vi.fn(async () => {});
    const checkNow = vi.fn(async () => {});
    const screen = await renderScreen(<CheckForUpdatesItem status={{ model: { channel: 'package', item }, run, checkNow }} />);
    const row = screen.findByTestId('settings-check-updates-row');
    if (!row) throw new Error('the Check for updates row did not render');
    return { row, run, checkNow };
}

describe('Settings › About › Check for updates', () => {
    it('checks now when nothing is waiting, and says where the app stands', async () => {
        const { row, run, checkNow } = await renderRow(appItem({ state: 'upToDate' }));

        expect(row.props.title).toBe('updates.action.checkNow');
        expect(row.props.subtitle).toBeTruthy();
        await invokeTestInstanceHandler(row, 'onPress');

        expect(checkNow).toHaveBeenCalledTimes(1);
        expect(run).not.toHaveBeenCalled();
    });

    it('takes the next step of an update that is waiting: download, then restart', async () => {
        for (const verb of ['update', 'restart'] as const) {
            const { row, run, checkNow } = await renderRow(appItem({
                state: verb === 'update' ? 'available' : 'ready',
                latestVersion: '0.3.7',
                action: { kind: 'run', verb },
            }));

            expect(row.props.detail).toEqual(expect.any(String));
            await invokeTestInstanceHandler(row, 'onPress');

            expect(run).toHaveBeenCalledTimes(1);
            expect(checkNow).not.toHaveBeenCalled();
        }
    });
});
