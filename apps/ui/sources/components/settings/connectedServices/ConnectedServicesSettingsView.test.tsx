import * as React from 'react';
import { ReactTestRenderer, act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    connectedServicesModuleState,
    installConnectedServicesCommonModuleMocks,
    resetConnectedServicesCommonModuleMockState,
} from './connectedServicesTestHelpers';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CapturedPickerModalConfig = Readonly<{
    component: React.ComponentType<Record<string, unknown>>;
    props: Record<string, unknown>;
}>;
const settingsViewModalShowMock = vi.fn((_config: CapturedPickerModalConfig) => 'settings-view-modal');

installConnectedServicesCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                show: (config: unknown) => settingsViewModalShowMock(config as CapturedPickerModalConfig),
            },
        }).module;
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            AppState: {
                currentState: 'active',
                addEventListener: vi.fn(() => ({ remove: vi.fn() })),
            },
            Platform: {
                OS: 'web',
                select: (options?: Readonly<{ default?: unknown }>) => (options && 'default' in options ? options.default : undefined),
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key, params) => {
                if (key === 'connectedServices.list.connectedCount') {
                    return `${(params as { count?: number } | undefined)?.count ?? 0} connected`;
                }
                return key;
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

const useFeatureEnabledSpy = vi.fn<(featureId: string) => boolean>(() => false);
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => useFeatureEnabledSpy(featureId),
}));

const useProfileSpy = vi.fn(() => ({
    connectedServicesV2: [
        {
            serviceId: 'openai-codex',
            profiles: [{ profileId: 'work', status: 'connected', kind: 'oauth' }],
        },
    ],
}));
vi.mock('@/sync/store/hooks', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/store/hooks')>(),
    useProfile: () => useProfileSpy(),
    useSettings: () => ({
        connectedServicesDefaultProfileByServiceId: {},
        connectedServicesProfileLabelByKey: {},
    }),
    useSettingMutable: () => [undefined, vi.fn()] as const,
    useLocalSetting: () => 1,
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

vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaBadges', () => ({
    useConnectedServiceQuotaBadges: () => ({}),
}));

// The page lists each subscription account's usage: only the relay below it is replaced.
const stableCredentials = { token: 't', secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') } as const;
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: stableCredentials }),
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
    fetchAccountEncryptionMode: async () => ({ mode: 'plain' as const, updatedAt: 0 }),
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV2', () => ({
    getConnectedServiceQuotaSnapshotSealed: async () => null,
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV3', () => ({
    getConnectedServiceQuotaSnapshotPlain: async () => null,
}));

async function openCodexDefaultAuthPicker(tree: ReactTestRenderer): Promise<ReactTestRenderer> {
    const trigger = tree.root.findAll((node) =>
        node.props?.testID === 'settings-connected-services-default-auth-codex'
    )[0];
    if (!trigger) {
        throw new Error('Expected default auth trigger for codex');
    }
    await act(async () => {
        trigger.props.onPress();
    });
    const config = settingsViewModalShowMock.mock.calls.at(-1)?.[0];
    if (!config) {
        throw new Error('Expected the default-auth picker modal to be shown');
    }
    const Content = config.component;
    return (await renderScreen(<Content {...config.props} />)).tree;
}

function selectPickerOption(modalTree: ReactTestRenderer, optionId: string) {
    const listProps = modalTree.root.findByProps({
        testID: 'new-session.connected-services.selection-list',
    }).props as { rootStep: { sections: ReadonlyArray<{ options: ReadonlyArray<{ id: string; onSelect: () => void }> }> } };
    for (const section of listProps.rootStep.sections) {
        const option = section.options.find((candidate) => candidate.id === optionId);
        if (option) {
            option.onSelect();
            return;
        }
    }
    throw new Error(`Selection option not found: ${optionId}`);
}

describe('ConnectedServicesSettingsView', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
        settingsViewModalShowMock.mockClear();
        resetConnectedServicesCommonModuleMockState();
        connectedServicesModuleState.options.modal = async () => {
            const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
            return createModalModuleMock({
                spies: {
                    show: (config: unknown) => settingsViewModalShowMock(config as CapturedPickerModalConfig),
                },
            }).module;
        };
        connectedServicesModuleState.options.text = async () => {
            const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
            return createTextModuleMock({
                translate: (key, params) => {
                    if (key === 'connectedServices.list.connectedCount') {
                        return `${(params as { count?: number } | undefined)?.count ?? 0} connected`;
                    }
                    return key;
                },
            });
        };
        useFeatureEnabledSpy.mockReset();
        useFeatureEnabledSpy.mockReturnValue(false);
        useProfileSpy.mockReset();
        useProfileSpy.mockReturnValue({
            connectedServicesV2: [
                {
                    serviceId: 'openai-codex',
                    profiles: [{ profileId: 'work', status: 'connected', kind: 'oauth' }],
                },
            ],
        });
    });

    it('does not expose connected services when the feature is disabled', async () => {
        const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(React.createElement(ConnectedServicesSettingsView))).tree;

        const items = tree.findAllByType('Item' as any);
        expect(items.length).toBe(0);
    });

    it('opens the service detail flow for default-auth connect recovery actions', async () => {
        useFeatureEnabledSpy.mockReturnValue(true);
        useProfileSpy.mockReturnValue({
            connectedServicesV2: [
                {
                    serviceId: 'openai-codex',
                    profiles: [],
                },
            ],
        });

        const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
        const { tree } = await renderScreen(React.createElement(ConnectedServicesSettingsView));

        const modalTree = await openCodexDefaultAuthPicker(tree);
        await act(async () => {
            selectPickerOption(modalTree, 'connected-service:openai-codex:connect');
        });

        expect(connectedServicesModuleState.routerPushSpy).toHaveBeenCalledWith({
            pathname: '/settings/connected-services/[serviceId]',
            params: { serviceId: 'openai-codex' },
        });
    });

    const pressable = (tree: ReactTestRenderer, testID: string) => tree.root.findAll((node) => (
        node.props?.testID === testID && typeof node.props.onPress === 'function'
    ))[0];

    it('invites the first account and offers every way to add one', async () => {
        useFeatureEnabledSpy.mockReturnValue(true);
        useProfileSpy.mockReturnValue({ connectedServicesV2: [] });

        const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
        const { tree } = await renderScreen(React.createElement(ConnectedServicesSettingsView));

        expect(tree.root.findAllByProps({ testID: 'connected-services-index:empty' })).not.toHaveLength(0);
        expect(pressable(tree, 'connected-services-index:add:openai-codex')).toBeDefined();
        expect(pressable(tree, 'connected-services-index:add:claude-subscription')).toBeDefined();

        await act(async () => {
            pressable(tree, 'connected-services-index:add:openai-codex')!.props.onPress();
        });
        expect(connectedServicesModuleState.routerPushSpy).toHaveBeenCalledWith({
            pathname: '/settings/connected-services/[serviceId]',
            params: { serviceId: 'openai-codex' },
        });
    });

    it('opens an account\'s service page from its card', async () => {
        useFeatureEnabledSpy.mockReturnValue(true);
        useProfileSpy.mockReturnValue({
            connectedServicesV2: [{
                serviceId: 'openai',
                profiles: [{ profileId: 'key', status: 'connected', kind: 'token' }],
            }],
        });

        const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
        const { tree } = await renderScreen(React.createElement(ConnectedServicesSettingsView));
        await act(async () => {
            pressable(tree, 'connected-services-index:usage:openai:key:manage')!.props.onPress();
        });

        expect(connectedServicesModuleState.routerPushSpy).toHaveBeenCalledWith({
            pathname: '/settings/connected-services/[serviceId]',
            params: { serviceId: 'openai' },
        });
    });

    it('narrows the accounts by tab and by search', async () => {
        useFeatureEnabledSpy.mockReturnValue(true);
        useProfileSpy.mockReturnValue({
            connectedServicesV2: [
                { serviceId: 'openai', profiles: [{ profileId: 'first', status: 'connected', kind: 'token' }] },
                { serviceId: 'anthropic', profiles: [{ profileId: 'second', status: 'connected', kind: 'token' }] },
            ],
        });
        const shown = (tree: ReactTestRenderer) => ['openai:first', 'anthropic:second'].filter((key) => (
            tree.root.findAll((node) => node.props?.testID === `connected-services-index:usage:${key}`).length > 0
        ));

        const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
        const { tree } = await renderScreen(React.createElement(ConnectedServicesSettingsView));
        expect(shown(tree)).toEqual(['openai:first', 'anthropic:second']);

        await act(async () => {
            pressable(tree, 'connected-services-index:tab:claude')!.props.onPress();
        });
        expect(shown(tree)).toEqual(['anthropic:second']);

        await act(async () => {
            pressable(tree, 'connected-services-index:tab:all')!.props.onPress();
        });
        const search = tree.root.findAll((node) => (
            node.props?.testID === 'connected-services-index:search' && typeof node.props.onChangeText === 'function'
        ))[0];
        await act(async () => {
            search!.props.onChangeText('FIRST');
        });
        expect(shown(tree)).toEqual(['openai:first']);

        const searchAgain = tree.root.findAll((node) => (
            node.props?.testID === 'connected-services-index:search' && typeof node.props.onChangeText === 'function'
        ))[0];
        await act(async () => {
            searchAgain!.props.onChangeText('nobody');
        });
        expect(shown(tree)).toEqual([]);
        expect(tree.root.findAllByProps({ testID: 'connected-services-index:empty' })).not.toHaveLength(0);
    });

    it('opens the OAuth recovery flow for default-auth OAuth reauth selections', async () => {
        useFeatureEnabledSpy.mockImplementation((featureId: string) =>
            featureId === 'connectedServices' || featureId === 'connectedServices.accountGroups'
        );
        useProfileSpy.mockReturnValue({
            connectedServicesV2: [
                {
                    serviceId: 'openai-codex',
                    profiles: [{ profileId: 'work', status: 'needs_reauth', kind: 'oauth' }],
                },
            ],
        });

        const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
        const { tree } = await renderScreen(React.createElement(ConnectedServicesSettingsView));

        const modalTree = await openCodexDefaultAuthPicker(tree);
        await act(async () => {
            selectPickerOption(modalTree, 'connected-service:openai-codex:reauth:work');
        });

        expect(connectedServicesModuleState.routerPushSpy).toHaveBeenCalledWith({
            pathname: '/settings/connected-services/oauth',
            params: { serviceId: 'openai-codex', profileId: 'work' },
        });
    });
});
