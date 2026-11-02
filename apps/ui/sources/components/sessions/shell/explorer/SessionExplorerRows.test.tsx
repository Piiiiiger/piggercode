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
    items: ReadonlyArray<{ id: string; destructive?: boolean }>;
    onSelect: (id: string) => void;
}>;
const menuState = vi.hoisted(() => ({ current: null as CapturedMenu | null }));
// The popover portal is not rendered by the test renderer; the menu's items and selection are the contract.
// ContextMenu stays real: it mounts this menu only while open, anchored to the row's ⋯ button.
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: CapturedMenu & {
        onOpenChange: (open: boolean) => void;
        trigger: ((args: { open: boolean; toggle: () => void }) => React.ReactNode) | null;
    }) => {
        menuState.current = props;
        return React.createElement('DropdownMenu', null, typeof props.trigger === 'function'
            ? props.trigger({ open: props.open, toggle: () => props.onOpenChange(!props.open) })
            : null);
    },
}));

afterEach(() => {
    menuState.current = null;
    standardCleanup();
});

describe('SessionExplorerFolderRow', () => {
    it('opens and closes on press, starts a session from + and reports whether it is open', async () => {
        const { SessionExplorerFolderRow } = await import('./SessionExplorerRows');
        const onToggle = vi.fn();
        const onCreateSession = vi.fn();
        const screen = await renderScreen(
            <SessionExplorerFolderRow
                testID="folder"
                title="code"
                depth={1}
                kind="folder"
                expanded={false}
                sessionCount={2}
                activeSessionCount={1}
                onToggle={onToggle}
                onCreateSession={onCreateSession}
            />,
        );

        expect(screen.findByTestId('folder')?.props.accessibilityState).toEqual({ expanded: false });
        await screen.pressByTestIdAsync('folder');
        expect(onToggle).toHaveBeenCalledTimes(1);
        await screen.pressByTestIdAsync('folder:new-session');
        expect(onCreateSession).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('folder:count')).not.toBeNull();
    });

    it('shows no session count for a folder without sessions and no + where sessions cannot start', async () => {
        const { SessionExplorerFolderRow } = await import('./SessionExplorerRows');
        const screen = await renderScreen(
            <SessionExplorerFolderRow
                testID="folder"
                title="vm"
                depth={0}
                kind="machine"
                expanded
                sessionCount={0}
                activeSessionCount={0}
                onToggle={vi.fn()}
                onCreateSession={null}
            />,
        );

        expect(screen.findByTestId('folder:count')).toBeNull();
        expect(screen.findByTestId('folder:new-session')).toBeNull();
    });

    it('makes and deletes folders from its ⋯ menu, with Delete in red', async () => {
        const { SessionExplorerFolderRow } = await import('./SessionExplorerRows');
        const onNewFolder = vi.fn();
        const onDeleteFolder = vi.fn();
        const screen = await renderScreen(
            <SessionExplorerFolderRow
                testID="folder"
                title="code"
                depth={1}
                kind="folder"
                expanded
                sessionCount={0}
                activeSessionCount={0}
                onToggle={vi.fn()}
                onCreateSession={vi.fn()}
                onNewFolder={onNewFolder}
                onDeleteFolder={onDeleteFolder}
            />,
        );

        await screen.pressByTestIdAsync('folder:menu');
        expect(menuState.current?.open).toBe(true);
        expect(menuState.current?.items.map((item) => [item.id, item.destructive === true])).toEqual([
            ['new-folder', false],
            ['delete-folder', true],
        ]);
        menuState.current?.onSelect('new-folder');
        expect(onNewFolder).toHaveBeenCalledTimes(1);
        menuState.current?.onSelect('delete-folder');
        expect(onDeleteFolder).toHaveBeenCalledTimes(1);
    });

    it('offers only a new folder in a top folder and no menu where folders cannot change', async () => {
        const { SessionExplorerFolderRow } = await import('./SessionExplorerRows');
        const top = await renderScreen(
            <SessionExplorerFolderRow
                testID="top"
                title="~"
                depth={0}
                kind="root"
                expanded
                sessionCount={0}
                activeSessionCount={0}
                onToggle={vi.fn()}
                onCreateSession={vi.fn()}
                onNewFolder={vi.fn()}
                onDeleteFolder={null}
            />,
        );
        await top.pressByTestIdAsync('top:menu');
        expect(menuState.current?.items.map((item) => item.id)).toEqual(['new-folder']);

        const other = await renderScreen(
            <SessionExplorerFolderRow
                testID="other"
                title="Other locations"
                depth={0}
                kind="other"
                expanded
                sessionCount={1}
                activeSessionCount={0}
                onToggle={vi.fn()}
                onCreateSession={null}
            />,
        );
        expect(other.findByTestId('other:menu')).toBeNull();
    });
});

describe('SessionExplorerStatusRow', () => {
    it('retries a folder that could not be listed', async () => {
        const { SessionExplorerStatusRow } = await import('./SessionExplorerRows');
        const onRetry = vi.fn();
        const screen = await renderScreen(
            <SessionExplorerStatusRow testID="status" status="error" depth={1} onRetry={onRetry} />,
        );

        await screen.pressByTestIdAsync('status');
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
