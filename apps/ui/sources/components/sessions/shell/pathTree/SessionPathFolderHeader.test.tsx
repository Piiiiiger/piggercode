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

describe('SessionPathFolderHeader', () => {
    it('toggles the folder on press and starts a session in it from its + button', async () => {
        const { SessionPathFolderHeader } = await import('./SessionPathFolderHeader');
        const onToggleCollapse = vi.fn();
        const onCreateSession = vi.fn();
        const screen = await renderScreen(
            <SessionPathFolderHeader
                testID="path-folder"
                title="code/happier"
                depth={1}
                sessionCount={2}
                activeSessionCount={1}
                collapsed={false}
                onToggleCollapse={onToggleCollapse}
                onCreateSession={onCreateSession}
            />,
        );

        await screen.pressByTestIdAsync('path-folder');
        expect(onToggleCollapse).toHaveBeenCalledTimes(1);
        await screen.pressByTestIdAsync('path-folder:new-session');
        expect(onCreateSession).toHaveBeenCalledTimes(1);
        expect(onToggleCollapse).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('path-folder')?.props.accessibilityState).toEqual({ expanded: true });
    });
});
