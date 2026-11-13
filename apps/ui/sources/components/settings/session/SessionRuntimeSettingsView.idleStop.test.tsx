import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView, type SettingsViewHarness } from '@/dev/testkit/harness/settingsViewHarness';
import { createStorageModuleMock } from '@/dev/testkit/mocks/storage';

import { installSessionSettingsCommonModuleMocks } from './sessionSettingsViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState = vi.hoisted(() => ({
    values: {} as Record<string, unknown>,
}));

installSessionSettingsCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string, params?: Record<string, unknown>) => params
                ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
                : key,
        });
    },
    storage: async (importOriginal) => createStorageModuleMock({
        importOriginal,
        overrides: {
            useSettingMutable: ((key: string) => {
                const [value, setValue] = React.useState<unknown>(() => settingsState.values[key] ?? null);
                return [
                    value,
                    (next: unknown) => {
                        settingsState.values[key] = next;
                        setValue(next);
                    },
                ] as const;
            }) as unknown as typeof import('@/sync/domains/state/storage')['useSettingMutable'],
        },
    }),
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: React.forwardRef((props: any, _ref) => React.createElement('ItemList', props, props.children)),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: any) => React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props, props.rightElement ?? null, props.children ?? null),
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: any) => React.createElement('Switch', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: (props: any) => React.createElement('TextInput', props),
}));

function findIdleStopMenu(screen: SettingsViewHarness) {
    const menu = screen.findAll((node) => (
        node.props?.itemTrigger?.itemProps?.testID === 'settings-session-idleStop-trigger'
    ))[0];
    if (!menu) throw new Error('idle stop menu not rendered');
    return menu;
}

describe('SessionRuntimeSettingsView idle stop', () => {
    beforeEach(() => {
        settingsState.values = { sessionIdleStopAfterMinutes: 180 };
    });

    it('offers idle hours and never, shows the current choice, and stores minutes or null', async () => {
        const mod = await import('./SessionRuntimeSettingsView');
        const screen = await renderSettingsView(React.createElement(mod.default));

        const menu = findIdleStopMenu(screen);
        expect(menu.props.selectedId).toBe('180');
        expect(menu.props.items.map((item: { id: string }) => item.id)).toEqual(['60', '180', '720', '1440', 'never']);
        expect(menu.props.itemTrigger.subtitle).toBe('settingsSession.idleStop.hoursTitle(count=3)');

        await act(async () => {
            menu.props.onSelect('never');
        });
        expect(settingsState.values.sessionIdleStopAfterMinutes).toBeNull();
        expect(findIdleStopMenu(screen).props.selectedId).toBe('never');

        await act(async () => {
            findIdleStopMenu(screen).props.onSelect('720');
        });
        expect(settingsState.values.sessionIdleStopAfterMinutes).toBe(720);
    });
});
