import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installMachineDetailsCommonModuleMocks } from './machineDetailsTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).expo = { EventEmitter: class {} };

const { refreshMachinesThrottledSpy, switchSpy, itemSpy, textInputSpy, detectedClisSpy, capabilitiesSpy, machineState } = vi.hoisted(() => ({
    refreshMachinesThrottledSpy: vi.fn(async () => {}),
    switchSpy: vi.fn(async () => true),
    itemSpy: vi.fn(),
    textInputSpy: vi.fn(),
    detectedClisSpy: vi.fn(),
    capabilitiesSpy: vi.fn(),
    machineState: { current: null as any },
}));

installMachineDetailsCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
            params: { id: 'machine-1' },
        });
        return routerMock.module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                storage: { getState: () => ({}) } as any,
                useSessions: () => [],
                useAllMachines: () => [machineState.current],
                useMachine: () => machineState.current,
                useSetting: () => false,
                useSettingMutable: () => [null, vi.fn()],
                useSettings: () => ({ schemaVersion: 1 } as any),
            },
        });
    },
});

vi.mock('@/components/ui/lists/Item', () => ({ Item: (props: any) => { itemSpy(props); return null; } }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: ({ children }: any) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/ui/lists/ItemList', () => ({ ItemList: ({ children }: any) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/ui/forms/MultiTextInput', () => ({ MultiTextInput: (props: any) => { textInputSpy(props); return null; } }));
vi.mock('@/components/ui/pathBrowser/PathInputBrowseButton', () => ({
    PathInputBrowseButton: () => null,
}));
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: vi.fn(async () => null),
}));
vi.mock('@/components/machines/DetectedClisList', () => ({ DetectedClisList: (props: any) => { detectedClisSpy(props); return null; } }));
vi.mock('@/components/ui/forms/Switch', () => ({ Switch: () => null }));
vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));
vi.mock('@/components/machines/InstallableDepInstaller', () => ({ InstallableDepInstaller: () => null }));

vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => () => {} }));
vi.mock('@/hooks/ui/useMountedShouldContinue', () => ({
    useMountedShouldContinue: () => () => true,
}));
vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
    useMachineCapabilitiesCache: (params: any) => { capabilitiesSpy(params); return { state: { status: 'idle' }, refresh: vi.fn() }; },
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const { createServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
    return createServerProfilesModuleMock({
        importOriginal,
        overrides: {
            getActiveServerId: () => 'server-a',
            listServerProfiles: () => [
                { id: 'server-a', serverUrl: 'https://server-a.example.test', name: 'Server A', createdAt: 1, updatedAt: 1, lastUsedAt: 1 },
                { id: 'server-b', serverUrl: 'https://server-b.example.test', name: 'Server B', createdAt: 2, updatedAt: 2, lastUsedAt: 2 },
            ],
        },
    });
});

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: switchSpy,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: refreshMachinesThrottledSpy,
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

vi.mock('@/utils/sessions/machineUtils', () => ({ isMachineOnline: () => true }));
vi.mock('@/utils/sessions/sessionUtils', () => ({ formatPathRelativeToHome: () => '', getSessionName: () => '', getSessionSubtitle: () => '' }));
vi.mock('@/utils/path/pathUtils', () => ({ resolveAbsolutePath: () => '' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionConsole', () => ({ resolveWindowsRemoteSessionConsoleFromMachineMetadata: () => 'visible' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchMode', () => ({
    readMachineWindowsRemoteSessionLaunchMode: () => undefined,
    resolveEffectiveWindowsRemoteSessionLaunchMode: () => ({ mode: 'visible' }),
}));
vi.mock('@/capabilities/installablesRegistry', () => ({ getInstallablesRegistryEntries: () => [] }));
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

describe('MachineDetailScreen (a computer that does not run agents)', () => {
    function machine(agentsHosted?: boolean) {
        const now = Date.now();
        return {
            id: 'machine-1',
            active: true,
            activeAt: now,
            createdAt: now,
            updatedAt: now,
            seq: 0,
            metadata: {
                displayName: 'Mac', host: 'mac', platform: 'darwin', homeDir: '/Users/me',
                ...(agentsHosted === undefined ? {} : { agentsHosted }),
            },
            metadataVersion: 1,
            daemonState: null,
            daemonStateVersion: 0,
            revokedAt: null,
        };
    }

    async function renderMachinePage(agentsHosted?: boolean) {
        machineState.current = machine(agentsHosted);
        for (const spy of [itemSpy, textInputSpy, detectedClisSpy, capabilitiesSpy]) spy.mockClear();
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        await renderScreen(React.createElement(MachineDetailScreen));
        await flushHookEffects({ cycles: 2, turns: 1 });
        return {
            launchSection: textInputSpy.mock.calls.length > 0,
            agentList: detectedClisSpy.mock.calls.length > 0,
            toolsItem: itemSpy.mock.calls.some(([props]) => props?.title === 'machine.tools.installablesTitle'),
            detectsAgents: capabilitiesSpy.mock.calls.some(([params]) => params?.enabled === true),
        };
    }

    it('offers no session launch, agent list or agent tools, and does not probe its agents', async () => {
        expect(await renderMachinePage(false)).toEqual({ launchSection: false, agentList: false, toolsItem: false, detectsAgents: false });
    });

    it('a machine that runs agents keeps all of them', async () => {
        expect(await renderMachinePage()).toEqual({ launchSection: true, agentList: true, toolsItem: true, detectsAgents: true });
    });
});
