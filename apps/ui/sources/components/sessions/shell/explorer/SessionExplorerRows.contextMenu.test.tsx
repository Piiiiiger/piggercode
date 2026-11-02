import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
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
    items: ReadonlyArray<{ id: string }>;
    onSelect: (id: string) => void;
}>;
const menuState = vi.hoisted(() => ({ current: null as CapturedMenu | null }));
// The popover portal is not rendered by the test renderer; the menu's items and placement are the contract.
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: CapturedMenu) => {
        menuState.current = props;
        return React.createElement('DropdownMenu', null);
    },
}));

afterEach(() => {
    menuState.current = null;
    standardCleanup();
});

describe('SessionExplorerFolderRow on the web', () => {
    it('opens the folder menu below the row on a right-click instead of the browser menu', async () => {
        const { SessionExplorerFolderRow } = await import('./SessionExplorerRows');
        const screen = await renderScreen(
            <SessionExplorerFolderRow
                testID="folder"
                title="code"
                depth={1}
                kind="folder"
                expanded={false}
                sessionCount={0}
                activeSessionCount={0}
                onToggle={vi.fn()}
                onCreateSession={vi.fn()}
                folderActions={{
                    newSession: null,
                    onNewFolder: vi.fn(),
                    onCopyPath: vi.fn(),
                    onOpenAsTop: null,
                    onRefresh: null,
                    onRename: null,
                    onDelete: vi.fn(),
                }}
            />,
        );
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

        await act(async () => {
            screen.findByTestId('folder:row')?.props.onContextMenu(event);
        });

        expect(event.preventDefault).toHaveBeenCalled();
        expect(menuState.current?.open).toBe(true);
        expect(menuState.current?.placement).toBe('bottom');
        expect(menuState.current?.items.map((item) => item.id)).toEqual(['new-folder', 'copy-path', 'delete-folder']);
    });
});
