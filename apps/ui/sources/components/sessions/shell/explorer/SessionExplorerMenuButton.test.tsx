import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('@/text', async () => {
    const { installTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return installTextModuleMock({ translate: (key: string) => key })();
});
vi.mock('react-native-unistyles', async () => {
    const { installUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return installUnistylesMock()();
});
vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: React.Attributes & Record<string, unknown>) => React.createElement('Ionicons', props),
}));

type CapturedMenu = Readonly<{
    open: boolean;
    items: ReadonlyArray<{ id: string; rightElement?: unknown }>;
    onSelect: (id: string) => void;
}>;
const menuState = vi.hoisted(() => ({ current: null as CapturedMenu | null }));

// The popover portal is not rendered by the test renderer; the menu's items and selection are the contract.
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: CapturedMenu & {
        onOpenChange: (open: boolean) => void;
        trigger: (args: { open: boolean; toggle: () => void }) => React.ReactNode;
    }) => {
        menuState.current = props;
        return React.createElement('DropdownMenu', null, props.trigger({ open: props.open, toggle: () => props.onOpenChange(!props.open) }));
    },
}));

afterEach(() => {
    menuState.current = null;
    standardCleanup();
});

describe('SessionExplorerMenuButton', () => {
    it('refreshes, collapses, and toggles hidden folders and stopped sessions from the explorer menu', async () => {
        const { SessionExplorerMenuButton } = await import('./SessionExplorerMenuButton');
        const handlers = {
            onRefresh: vi.fn(),
            onCollapseAll: vi.fn(),
            onShowHiddenChange: vi.fn(),
            onHideInactiveSessionsChange: vi.fn(),
            onOpenFolder: vi.fn(),
            onCloseFolder: vi.fn(),
        };
        const screen = await renderScreen(
            <SessionExplorerMenuButton showHidden={false} hideInactiveSessions={false} folderOpened={false} {...handlers} />,
        );

        await screen.pressByTestIdAsync('session-explorer-menu-trigger');
        expect(menuState.current?.open).toBe(true);

        const menu = menuState.current!;
        menu.onSelect('refresh');
        menu.onSelect('collapse-all');
        menu.onSelect('show-hidden');
        menu.onSelect('hide-inactive');
        menu.onSelect('open-folder');
        expect(handlers.onOpenFolder).toHaveBeenCalledTimes(1);
        // With the home folder at the top there is no folder to close.
        expect(menu.items.some((item) => item.id === 'close-folder')).toBe(false);
        expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
        expect(handlers.onCollapseAll).toHaveBeenCalledTimes(1);
        expect(handlers.onShowHiddenChange).toHaveBeenCalledWith(true);
        expect(handlers.onHideInactiveSessionsChange).toHaveBeenCalledWith(true);
        expect(menu.items.find((item) => item.id === 'show-hidden')?.rightElement).toBeFalsy();
    });

    it('marks hidden folders as shown, turns them off again and goes back to the home folder', async () => {
        const { SessionExplorerMenuButton } = await import('./SessionExplorerMenuButton');
        const onShowHiddenChange = vi.fn();
        const onCloseFolder = vi.fn();
        await renderScreen(
            <SessionExplorerMenuButton
                showHidden
                hideInactiveSessions
                folderOpened
                onRefresh={vi.fn()}
                onCollapseAll={vi.fn()}
                onShowHiddenChange={onShowHiddenChange}
                onHideInactiveSessionsChange={vi.fn()}
                onOpenFolder={vi.fn()}
                onCloseFolder={onCloseFolder}
            />,
        );

        const menu = menuState.current!;
        expect(menu.items.find((item) => item.id === 'show-hidden')?.rightElement).toBeTruthy();
        expect(menu.items.some((item) => item.id === 'show-inactive')).toBe(true);
        menu.onSelect('show-hidden');
        expect(onShowHiddenChange).toHaveBeenCalledWith(false);
        menu.onSelect('close-folder');
        expect(onCloseFolder).toHaveBeenCalledTimes(1);
    });
});
