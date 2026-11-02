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

afterEach(() => {
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
