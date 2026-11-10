import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'web' }));

installSessionDetailsPanelCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
        const platformOverride = {};
        Object.defineProperty(platformOverride, 'OS', {
            get: () => platform.os,
            enumerable: true,
            configurable: true,
        });
        return createReactNativeNativeMock({ platformOS: 'ios' }, { Platform: platformOverride });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useLocalSetting: () => 'sidebar',
            useSettings: () => ({}),
        });
    },
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/utils/platform/responsive', () => ({
    useDeviceType: () => 'tablet',
}));

vi.mock('@/components/sessions/files/views/SessionRepositoryTreeBrowserView', () => ({
    SessionRepositoryTreeBrowserView: () => React.createElement('FilesView'),
}));

vi.mock('@/components/sessions/panes/git/SessionRightPanelGitView', () => ({
    SessionRightPanelGitView: () => React.createElement('GitView'),
}));

let scopeState: any = { right: { isOpen: true, activeTabId: 'git', tabState: {} } };

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => {
        const [, bump] = React.useState(0);
        return {
            scopeState,
            openRight: vi.fn(),
            setRightTab: (tabId: string) => {
                scopeState.right.activeTabId = tabId;
                bump((value) => value + 1);
            },
            closeRight: vi.fn(),
            openDetailsTab: vi.fn(),
        };
    },
}));

/** The surface test id sits on both the `RightTabSurface` element and the `View` it renders. */
function findFilesSurfaceHost(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return screen
        .findAllByTestId('session-rightpanel-surface-files')
        .find((node) => typeof node.type === 'string') ?? null;
}

describe('SessionRightPanel (inactive tabs)', () => {
    beforeEach(() => {
        platform.os = 'ios';
        scopeState = { right: { isOpen: true, activeTabId: 'git', tabState: {} } };
    });

    it('takes an inactive native surface out of the screen-reader cursor', async () => {
        const { SessionRightPanel } = await import('./SessionRightPanel');
        const screen = await renderScreen(<SessionRightPanel sessionId="s1" scopeId="session:s1" />);

        await screen.pressByTestIdAsync('session-rightpanel-tab:files');
        const active = findFilesSurfaceHost(screen);
        expect(active).not.toBeNull();
        expect(active!.props.accessibilityElementsHidden).toBeUndefined();

        await screen.pressByTestIdAsync('session-rightpanel-tab:git');
        const inactive = findFilesSurfaceHost(screen);
        expect(inactive!.props.accessibilityElementsHidden).toBe(true);
        expect(inactive!.props.importantForAccessibility).toBe('no-hide-descendants');
    });
});
