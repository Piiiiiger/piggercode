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

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/components/settings/connectedServices/ProviderUsageGaugeSettingsGroup', () => ({
    ProviderUsageGaugeSettingsGroup: () => null,
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

function findSubagentLimitMenu(screen: SettingsViewHarness) {
    const menu = screen.findAll((node) => (
        node.props?.itemTrigger?.itemProps?.testID === 'settings-session-subagentLimit-trigger'
    ))[0];
    if (!menu) throw new Error('subagent limit menu not rendered');
    return menu;
}

describe('SessionProviderLimitsSettingsView subagent limit', () => {
    beforeEach(() => {
        settingsState.values = { sessionSubagentLimit: null };
    });

    it('offers no limit, off and fixed counts, and stores the choice', async () => {
        const mod = await import('./SessionProviderLimitsSettingsView');
        const screen = await renderSettingsView(React.createElement(mod.default));

        const menu = findSubagentLimitMenu(screen);
        expect(menu.props.selectedId).toBe('unlimited');
        expect(menu.props.items.map((item: { id: string }) => item.id)).toEqual(['unlimited', '0', '1', '2', '3', '5']);
        expect(menu.props.items[2].title).toBe('settingsSession.subagentLimit.countTitle(count=1)');

        act(() => {
            menu.props.onSelect('0');
        });
        expect(settingsState.values.sessionSubagentLimit).toBe(0);
        expect(findSubagentLimitMenu(screen).props.selectedId).toBe('0');

        act(() => {
            findSubagentLimitMenu(screen).props.onSelect('3');
        });
        expect(settingsState.values.sessionSubagentLimit).toBe(3);

        act(() => {
            findSubagentLimitMenu(screen).props.onSelect('unlimited');
        });
        expect(settingsState.values.sessionSubagentLimit).toBeNull();
    });

    it('keeps a limit chosen elsewhere selectable', async () => {
        settingsState.values.sessionSubagentLimit = 4;
        const mod = await import('./SessionProviderLimitsSettingsView');
        const screen = await renderSettingsView(React.createElement(mod.default));

        const menu = findSubagentLimitMenu(screen);
        expect(menu.props.selectedId).toBe('4');
        expect(menu.props.items.map((item: { id: string }) => item.id)).toEqual(['unlimited', '0', '1', '2', '3', '4', '5']);
    });
});
