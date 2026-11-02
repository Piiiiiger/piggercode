import * as React from 'react';
import { act } from 'react-test-renderer';
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

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

type CapturedMenu = Readonly<{
    open: boolean;
    placement?: string;
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

    function folderActions() {
        return {
            newSession: { machineId: 'm1', preferredAgentId: 'claude' as const, start: vi.fn() },
            onNewFolder: vi.fn(),
            onCopyPath: vi.fn(),
            onOpenAsTop: vi.fn(),
            onRefresh: vi.fn(),
            onRename: vi.fn(),
            onDelete: vi.fn(),
        };
    }

    it('offers the folder menu from ⋯, VS Code style with Delete last in red, and runs the picked action', async () => {
        const { SessionExplorerFolderRow } = await import('./SessionExplorerRows');
        const actions = folderActions();
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
                folderActions={actions}
            />,
        );

        await screen.pressByTestIdAsync('folder:menu');
        expect(menuState.current?.open).toBe(true);
        expect(menuState.current?.items.map((item) => [item.id, item.destructive === true])).toEqual([
            ['new-session:claude', false],
            ['new-folder', false],
            ['copy-path', false],
            ['open-as-top', false],
            ['refresh', false],
            ['rename-folder', false],
            ['delete-folder', true],
        ]);
        menuState.current?.onSelect('new-session:claude');
        expect(actions.newSession.start).toHaveBeenCalledWith('claude');
        menuState.current?.onSelect('rename-folder');
        menuState.current?.onSelect('delete-folder');
        expect([actions.onRename.mock.calls.length, actions.onDelete.mock.calls.length]).toEqual([1, 1]);
    });

    it('opens the same menu from a long press, leaves out what a top folder cannot do, and has none without actions', async () => {
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
                folderActions={{ ...folderActions(), onOpenAsTop: null, onRename: null, onDelete: null }}
            />,
        );
        await act(async () => {
            top.findByTestId('top')?.props.onLongPress();
        });
        expect(menuState.current?.placement).toBe('bottom');
        expect(menuState.current?.items.map((item) => item.id)).toEqual(['new-session:claude', 'new-folder', 'copy-path', 'refresh']);

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
        expect(other.findByTestId('other')?.props.onLongPress).toBeUndefined();
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
