import * as React from 'react';
import Constants from 'expo-constants';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSettingsViewCommonModuleMocks } from './settingsViewTestHelpers';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockFeatureEnabled: (featureId: string) => boolean = () => false;

const routerPushSpy = vi.fn();

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock(
            {
                View: 'View',
                Pressable: 'Pressable',
                Dimensions: {
                    get: () => ({ width: 1600, height: 900, scale: 2, fontScale: 1 }),
                },
                useWindowDimensions: () => ({ width: 1600, height: 900, scale: 2, fontScale: 1 }),
                Platform: {
                    OS: 'web',
                    select: (options: any) => (options && 'default' in options ? options.default : undefined),
                },
                Linking: {
                    canOpenURL: async () => false,
                    openURL: async () => {},
                },
                Text: 'Text',
                ActivityIndicator: 'ActivityIndicator',
            },
        );
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { push: routerPushSpy },
        });
        return routerMock.module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: vi.fn(),
                confirm: vi.fn(async () => false),
                prompt: vi.fn(async () => null),
            },
        }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useEntitlement: () => false,
            useLocalSettingMutable: () => [false, vi.fn()],
            useSetting: (key: string) => {
                if (key === 'serverSelectionGroups') return [];
                if (key === 'serverSelectionActiveTargetKind') return null;
                if (key === 'serverSelectionActiveTargetId') return null;
                if (key === 'experiments') return false;
                if (key === 'featureToggles') return {};
                if (key === 'useProfiles') return false;
                if (key === 'sessionUseTmux') return false;
                return null;
            },
            useAllMachines: () => [],
            useMachineListByServerId: () => ({}),
            useMachineListStatusByServerId: () => ({}),
            useProfile: () => ({ id: 'prof_1', firstName: '', connectedServices: [] }),
        });
    },
});

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'StyledText',
    TextInput: 'TextInput',
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const routerMock = createExpoRouterMock({
        router: { push: routerPushSpy },
    });
    return routerMock.module;
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (_cb: () => void) => {},
}));

vi.mock('expo-constants', () => ({
    default: { expoConfig: { version: '0.0.0-test' } },
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: any) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: any) => React.createElement('ItemGroup', null, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => ({ connectTerminal: vi.fn(), connectWithUrl: vi.fn(), isLoading: false }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: null }),
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: vi.fn(async () => {}),
        presentPaywall: vi.fn(async () => ({ success: false, error: 'nope' })),
        refreshProfile: vi.fn(async () => {}),
    },
}));

vi.mock('@/track', () => ({
    trackPaywallButtonClicked: vi.fn(),
    trackWhatsNewClicked: vi.fn(),
}));

vi.mock('@/hooks/ui/useMultiClick', () => ({
    useMultiClick: (cb: () => void) => cb,
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 1000 },
}));

vi.mock('@/hooks/ui/useHappyAction', () => ({
    useHappyAction: (fn: any) => [false, fn],
}));

vi.mock('@/sync/api/account/apiVendorTokens', () => ({
    disconnectVendorToken: vi.fn(async () => {}),
}));

vi.mock('@/sync/domains/profiles/profile', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/profiles/profile')>(),
    getDisplayName: () => 'Test User',
    getAvatarUrl: () => null,
    getBio: () => '',
}));

vi.mock('@/components/ui/avatar/Avatar', () => ({
    Avatar: 'Avatar',
}));

vi.mock('@/components/sessions/new/components/MachineCliGlyphs', () => ({
    MachineCliGlyphs: 'MachineCliGlyphs',
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['codex', 'claude'],
    DEFAULT_AGENT_ID: 'agent_default',
    getAgentCore: () => ({ uiConnectedService: { serviceId: 'anthropic', label: 'Anthropic', connectRoute: null } }),
    getAgentIconSource: () => null,
    getAgentIconTintColor: () => null,
    resolveAgentIdFromConnectedServiceId: () => null,
}));

vi.mock('@/utils/platform/deferOnWeb', () => ({
    deferOnWeb: (action: () => void) => action(),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => mockFeatureEnabled(featureId),
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => null,
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-1', serverUrl: 'https://local.example.test', generation: 0 }),
    listServerProfiles: () => [],
    subscribeActiveServer: (listener: any) => {
        listener({ serverId: 'server-1', serverUrl: 'https://local.example.test', generation: 0 });
        return () => {};
    },
}));

afterEach(() => {
    vi.useRealTimers();
    routerPushSpy.mockClear();
    mockFeatureEnabled = () => false;
});

describe('SettingsView (entries)', () => {
    async function renderSettingsViewUnderTest() {
        vi.useFakeTimers();
        const { SettingsView } = await import('./SettingsView');
        const screen = await renderSettingsView(
            React.createElement(SettingsView),
            { flushOptions: { runAllTimers: true, cycles: 8 } },
        );
        for (let index = 0; index < 8; index += 1) {
            await act(async () => {
                await vi.runOnlyPendingTimersAsync();
            });
        }
        return screen;
    }

    it('includes a Permissions entry that routes to /settings/session/permissions', async () => {
        const screen = await renderSettingsViewUnderTest();
        expect(screen.findRowByTitle('settings.permissions')).toBeTruthy();

        await screen.pressRowByTitle('settings.permissions');

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/session/permissions');
    });

    it('includes a Connected services entry that routes through the settings stack', async () => {
        mockFeatureEnabled = (featureId) => featureId === 'connectedServices';
        const screen = await renderSettingsViewUnderTest();
        expect(screen.findRowByTitle('settings.connectedServices')).toBeTruthy();

        await screen.pressRowByTitle('settings.connectedServices');

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/connected-services');
    });

    it('includes an Actions entry that routes to /settings/actions', async () => {
        const screen = await renderSettingsViewUnderTest();
        expect(screen.findRowByTitle('common.actions')).toBeTruthy();

        await screen.pressRowByTitle('common.actions');

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/actions');
    });

    it("omits the What's New entry when changelog UI is disabled by build policy", async () => {
        const previousDeny = process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY;
        process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY = 'app.ui.changelog';
        vi.resetModules();

        try {
            const screen = await renderSettingsViewUnderTest();
            expect(screen.findRowByTitle('settings.whatsNew')).toBeNull();
        } finally {
            if (previousDeny === undefined) delete process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY;
            else process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY = previousDeny;
        }
    });

    it('keeps About to the version, without upstream Happier links', async () => {
        const screen = await renderSettingsViewUnderTest();

        expect(screen.findRowByTitle('common.version')).toBeTruthy();
        for (const upstreamEntry of [
            'settings.github',
            'settings.reportIssue',
            'settings.privacyPolicy',
            'settings.termsOfService',
            'settings.eula',
        ]) {
            expect(screen.findRowByTitle(upstreamEntry)).toBeNull();
        }
    });

    it("links About to the build's own repository", async () => {
        // This file's expo-constants mock has no `extra`; give it the build's brand config for this case.
        const expoConfig = Constants.expoConfig as { extra?: Record<string, unknown> };
        expoConfig.extra = { app: { repositoryUrl: 'https://github.com/Piiiiiger/piggercode' } };
        try {
            const screen = await renderSettingsViewUnderTest();

            const repositoryRow = screen.findRowByTitle('connectedServices.serviceNames.github');
            expect(repositoryRow?.props.subtitle).toBe('Piiiiiger/piggercode');
        } finally {
            delete expoConfig.extra;
        }
    });

    it('hides feature-gated entries when disabled by feature policy', async () => {
        mockFeatureEnabled = () => false;
        const screen = await renderSettingsViewUnderTest();

        expect(screen.findRowByTitle('settings.filesSourceControl')).toBeNull();
        expect(screen.findRowByTitle('settings.memorySearch')).toBeNull();
    });

    it('shows feature-gated entries when source control and memory search are enabled', async () => {
        mockFeatureEnabled = (featureId) => ['scm.writeOperations', 'memory.search'].includes(featureId);
        const screen = await renderSettingsViewUnderTest();

        expect(screen.findRowByTitle('settings.filesSourceControl')).toBeTruthy();
        expect(screen.findRowByTitle('settings.memorySearch')).toBeTruthy();
    });
});
