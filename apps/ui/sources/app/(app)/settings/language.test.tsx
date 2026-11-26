import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('@/sync/domains/state/storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/state/storage')>()),
    useSettingMutable: () => [null, (value: string | null) => { calls.push(`set:${value}`); }],
}));

vi.mock('@/sync/sync', () => ({
    sync: { flushPendingSettingsNow: () => { calls.push('flush'); } },
}));

vi.mock('@/hooks/inbox/useUpdates', () => ({
    useUpdates: () => ({ reloadApp: async () => { calls.push('reload'); } }),
}));

vi.mock('expo-localization', () => ({
    getLocales: () => [{ languageTag: 'en-US' }],
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ confirmResult: true }).module;
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

describe('Settings › Language', () => {
    it('persists the pending language setting before it reloads the app', async () => {
        const { default: LanguageSettingsScreen } = await import('./language');
        const { getLanguageNativeName } = await import('@/text');
        const screen = await renderScreen(<LanguageSettingsScreen />);
        const row = screen.findAllByType('Item' as never).find((node) => node.props.title === getLanguageNativeName('zh-Hans'));

        await pressTestInstanceAsync(row, 'language row');

        expect(calls).toEqual(['set:zh-Hans', 'flush', 'reload']);
    });
});
