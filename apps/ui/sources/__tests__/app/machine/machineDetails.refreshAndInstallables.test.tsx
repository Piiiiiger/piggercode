import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { createUseSettingMock, flushHookEffects, renderScreen } from '@/dev/testkit';
import { installMachineDetailsCommonModuleMocks } from './machineDetailsTestHelpers';

const fixedNow = 1_700_000_000_000;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).expo = { EventEmitter: class { } };

const {
    modalSpies,
    routerPushSpy,
    runRefreshDiagnosticActionSpy,
    stopSessionSpy,
} = vi.hoisted(() => ({
    modalSpies: {
        alert: vi.fn(),
        confirm: vi.fn(),
        prompt: vi.fn(),
        show: vi.fn(),
    },
    routerPushSpy: vi.fn(),
    runRefreshDiagnosticActionSpy: vi.fn(async (_context: unknown, action: () => Promise<unknown>) => action()),
    stopSessionSpy: vi.fn<(..._args: any[]) => Promise<any>>(async (..._args: any[]) => ({ ok: true })),
}));

installMachineDetailsCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { back: vi.fn(), push: routerPushSpy, replace: vi.fn() },
            params: { id: 'machine-1' },
        }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: modalSpies,
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSessions: () => [],
            useMachine: () => ({
                id: 'machine-1',
                activeAt: fixedNow,
                metadata: { platform: 'darwin', windowsRemoteSessionConsole: 'visible' },
                metadataVersion: 1,
                daemonStateVersion: 1,
            }),
            useSetting: createUseSettingMock({
                fallback: () => false,
            }),
            useSettingMutable: () => [null, vi.fn()],
            useSettings: () => ({}),
        });
    },
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement(
            'Pressable',
            {
                testID: `item:${props.title}`,
                onPress: props.onPress,
            },
            React.isValidElement(props.rightElement)
                ? React.cloneElement(props.rightElement, { testID: `item-right:${props.title}` })
                : props.rightElement ?? null,
        ),
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ title, children }: any) => React.createElement('View', { testID: `item-group:${title}` }, children),
}));
vi.mock('@/components/ui/lists/ItemGroupTitleWithAction', () => ({ ItemGroupTitleWithAction: () => null }));
vi.mock('@/components/ui/lists/ItemList', () => ({ ItemList: ({ children }: any) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/ui/forms/MultiTextInput', () => ({ MultiTextInput: () => null }));
vi.mock('@/components/ui/pathBrowser/PathInputBrowseButton', () => ({
    PathInputBrowseButton: () => null,
}));
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: vi.fn(async () => null),
}));
vi.mock('@/components/machines/DetectedClisList', () => ({ DetectedClisList: () => null }));
vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: any) => React.createElement('Pressable', {
        testID: props.testID ?? 'switch',
        onPress: () => props.onValueChange?.(!props.value),
    }),
}));
vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));
vi.mock('@/components/machines/InstallableDepInstaller', () => ({ InstallableDepInstaller: () => null }));
vi.mock('@/sync/ops', () => ({
    machineSpawnNewSession: vi.fn(async () => ({ type: 'error', errorCode: 'unexpected', errorMessage: 'noop' })),
    machineStopDaemon: vi.fn(async () => ({ message: 'noop' })),
    machineStopSession: (...args: any[]) => stopSessionSpy(...args),
    machineUpdateMetadata: vi.fn(async () => ({})),
}));

vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => () => { } }));
vi.mock('@/hooks/ui/useMountedShouldContinue', () => ({
    useMountedShouldContinue: () => () => true,
}));
vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({ useMachineCapabilitiesCache: () => ({ state: { status: 'idle' }, refresh: vi.fn() }) }));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerId: () => 'server-a',
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: vi.fn(),
        refreshMachines: vi.fn(),
        retryNow: vi.fn(),
    },
}));
vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>, options?: { onError?: (error: unknown) => void }) => {
        void promise.catch((error) => {
            options?.onError?.(error);
        });
    },
}));
vi.mock('@/utils/errors/daemonUnavailableAlert', () => ({
    tryShowDaemonUnavailableAlertForRpcError: () => false,
    tryShowDaemonUnavailableAlertForRpcFailure: () => false,
}));
vi.mock('@/utils/system/userInteractionDiagnostics', () => ({
    runRefreshDiagnosticAction: (context: unknown, action: () => Promise<unknown>) =>
        runRefreshDiagnosticActionSpy(context, action),
}));

vi.mock('@/utils/sessions/machineUtils', () => ({ isMachineOnline: () => true }));
vi.mock('@/utils/sessions/sessionUtils', () => ({ formatPathRelativeToHome: () => '', getSessionName: () => '', getSessionSubtitle: () => '' }));
vi.mock('@/utils/path/pathUtils', () => ({ resolveAbsolutePath: () => '' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionConsole', () => ({ resolveWindowsRemoteSessionConsoleFromMachineMetadata: () => 'visible' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchMode', () => ({
    readMachineWindowsRemoteSessionLaunchMode: () => undefined,
    resolveEffectiveWindowsRemoteSessionLaunchMode: () => ({ mode: 'visible' }),
}));
vi.mock('@/capabilities/installablesRegistry', () => ({ getInstallablesRegistryEntries: () => [] }));
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: vi.fn(async () => true),
}));
vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['codex'],
    DEFAULT_AGENT_ID: 'codex',
    getAgentCore: () => ({ cli: { detectKey: 'codex' } }),
    isAgentId: () => true,
}));
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: () => null,
}));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchModeOptions', () => ({
    WINDOWS_REMOTE_SESSION_LAUNCH_MODE_OPTIONS: [],
}));
vi.mock('@/sync/ops/sessionMachineTarget', () => ({
    readMachineTargetForSession: () => null,
}));

describe('MachineDetailScreen', () => {
    beforeEach(() => {
        routerPushSpy.mockClear();
        runRefreshDiagnosticActionSpy.mockClear();
        stopSessionSpy.mockClear();
        modalSpies.confirm.mockClear();
    });

    it('wraps pull-to-refresh in refresh diagnostics', async () => {
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await flushHookEffects();
        const scrollView = screen.tree.root.findAll((node) => Boolean(node.props.refreshControl))[0];
        expect(scrollView).toBeTruthy();
        const refreshControl = scrollView.props.refreshControl;

        await act(async () => {
            await refreshControl.props.onRefresh();
        });

        expect(runRefreshDiagnosticActionSpy).toHaveBeenCalledWith({
            action: 'pull_to_refresh',
            screen: 'machine_detail',
        }, expect.any(Function));
    });

    it('includes an Installables navigation item', async () => {
        routerPushSpy.mockClear();
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await flushHookEffects();

        expect(screen.findByTestId('item:machine.tools.installablesTitle')).toBeTruthy();
        await screen.pressByTestIdAsync('item:machine.tools.installablesTitle');

        expect(routerPushSpy).toHaveBeenCalled();
    });

});
