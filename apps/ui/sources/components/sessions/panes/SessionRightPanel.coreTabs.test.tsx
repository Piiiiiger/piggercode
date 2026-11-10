import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, type RenderScreenResult } from '@/dev/testkit';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let terminalFeatureEnabled = false;

const openRightSpy = vi.fn();
const setRightTabSpy = vi.fn();

let scopeState: any = {
    right: { isOpen: true, activeTabId: 'git', tabState: {} },
};

installSessionDetailsPanelCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Pressable: 'Pressable',
            ActivityIndicator: 'ActivityIndicator',
            AppState: {
                currentState: 'active',
                addEventListener: () => ({ remove: () => {} }),
            },
            Platform: {
                select: () => 1,
            },
        });
    },
    icons: () => ({
        Octicons: 'Octicons',
    }),
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useLocalSetting: () => 'sidebar',
        });
    },
});

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/utils/platform/deferOnWeb', () => ({
    deferOnWeb: (fn: any) => fn(),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'terminal.embeddedPty' ? terminalFeatureEnabled : false,
}));

vi.mock('@/utils/platform/responsive', () => ({
    useDeviceType: () => 'tablet',
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        scopeState,
        openRight: openRightSpy,
        setRightTab: setRightTabSpy,
        closeRight: vi.fn(),
        openDetailsTab: vi.fn(),
    }),
}));

vi.mock('@/components/sessions/files/views/SessionRepositoryTreeBrowserView', () => ({
    SessionRepositoryTreeBrowserView: () => React.createElement('FilesView'),
}));

vi.mock('@/components/sessions/panes/git/SessionRightPanelGitView', () => ({
    SessionRightPanelGitView: () => React.createElement('GitView'),
}));

vi.mock('@/components/sessions/panes/terminal/SessionRightPanelTerminalView', () => ({
    SessionRightPanelTerminalView: () => React.createElement('TerminalView'),
}));

function findHostByTestId(screen: RenderScreenResult, testID: string) {
    return screen.findAllByTestId(testID).find((node) => typeof node.type === 'string') ?? null;
}

describe('SessionRightPanel (core tabs)', () => {
    beforeEach(() => {
        terminalFeatureEnabled = false;
        scopeState = { right: { isOpen: true, activeTabId: 'git', tabState: {} } };
        openRightSpy.mockClear();
        setRightTabSpy.mockClear();
        vi.clearAllMocks();
    });

    it('renders the git and files tabs and shows the git surface by default', async () => {
        const { SessionRightPanel } = await import('./SessionRightPanel');

        const screen = await renderScreen(<SessionRightPanel sessionId="s1" scopeId="session:s1" />);

        expect(screen.findByTestId('session-rightpanel-tab:git')).toBeTruthy();
        expect(screen.findByTestId('session-rightpanel-tab:files')).toBeTruthy();
        expect(screen.findByTestId('session-rightpanel-tab:terminal')).toBeNull();

        const gitSurface = findHostByTestId(screen, 'session-rightpanel-surface-git');
        expect(gitSurface).not.toBeNull();
        expect(gitSurface?.props.pointerEvents).toBe('auto');
        expect(findHostByTestId(screen, 'session-rightpanel-surface-files')).toBeNull();
    });

    it.each(['agents', 'navigation'])('opens git for a %s tab saved by an older version, and saves git instead', async (savedTab) => {
        scopeState = { right: { isOpen: true, activeTabId: savedTab, tabState: {} } };
        const { SessionRightPanel } = await import('./SessionRightPanel');

        const screen = await renderScreen(<SessionRightPanel sessionId="s1" scopeId="session:s1" />);

        expect(findHostByTestId(screen, 'session-rightpanel-surface-git')?.props.pointerEvents).toBe('auto');
        expect(findHostByTestId(screen, 'session-rightpanel-surface-files')).toBeNull();
        expect(setRightTabSpy).toHaveBeenCalledWith('git');
    });
});
