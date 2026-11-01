import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { getPathBrowserRowTestId } from '@/components/ui/pathBrowser/pathBrowserTestIds';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const listMachineFileBrowserDirectoryEntriesMock = vi.hoisted(() => vi.fn());
const machineCreateDirectoryMock = vi.hoisted(() => vi.fn(async () => ({ success: true as const })));
const downloadDaemonSessionFileToDestinationMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Pressable: 'Pressable',
        ActivityIndicator: 'ActivityIndicator',
        useWindowDimensions: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
        FlatList: React.forwardRef(({ data, renderItem, ListHeaderComponent }: any, ref) => {
            React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn(), scrollToOffset: vi.fn() }));
            return React.createElement('FlatList', null, [
                React.createElement(React.Fragment, { key: 'header' }, ListHeaderComponent ?? null),
                ...(data ?? []).map((item: any, index: number) =>
                    React.createElement(React.Fragment, { key: `${item.type}:${item.path}:${index}` }, renderItem({ item, index }))),
            ]);
        }),
        Platform: {
            OS: 'web',
            select: (options: { web?: unknown; default?: unknown }) => options.web ?? options.default,
        },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: (props: any) => React.createElement('RoundButton', props),
}));
vi.mock('@/sync/store/hooks', () => ({
    useLocalSetting: (key: string) => (key === 'uiFontScale' ? 1 : null),
}));
vi.mock('@/modal', () => createModalModuleMock({ spies: { alert: vi.fn(), confirm: vi.fn(async () => false) } }).module);

// Machine and session RPC boundaries.
vi.mock('@/sync/ops/machines', () => ({
    machineCreateDirectory: (...args: unknown[]) => (machineCreateDirectoryMock as any)(...args),
}));
vi.mock('@/sync/ops/machineRipgrep', () => ({ machineRipgrep: vi.fn(async () => ({ success: true, stdout: '' })) }));
vi.mock('@/sync/domains/input/machineFileBrowser', () => ({
    clearCachedMachineFileBrowserEntries: () => {},
    clearCachedMachineFileBrowserRoots: () => {},
    getCachedMachineFileBrowserDirectoryMetadata: () => null,
    getCachedMachineFileBrowserEntries: () => null,
    getCachedMachineFileBrowserRoots: () => null,
    listMachineFileBrowserDirectoryEntries: (params: unknown) => listMachineFileBrowserDirectoryEntriesMock(params),
    listMachineFileBrowserRoots: vi.fn(),
    warmMachineFileBrowserDirectoryCache: (params: unknown) => listMachineFileBrowserDirectoryEntriesMock(params),
    warmMachineFileBrowserRoots: vi.fn(),
}));
vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline/daemonSessionFiles', () => ({
    downloadDaemonSessionFileToDestination: (...args: unknown[]) => downloadDaemonSessionFileToDestinationMock(...args),
    uploadDaemonSessionFileFromReader: vi.fn(),
}));
vi.mock('@/sync/ops', () => ({ sessionStatFile: vi.fn(async () => ({ success: true, exists: false })) }));

describe('SharedFolderModal', () => {
    beforeEach(() => {
        listMachineFileBrowserDirectoryEntriesMock.mockReset();
        machineCreateDirectoryMock.mockClear();
        downloadDaemonSessionFileToDestinationMock.mockReset();
    });

    it('creates the folder, lists it by its absolute path and downloads a clicked file from there', async () => {
        listMachineFileBrowserDirectoryEntriesMock.mockResolvedValue({
            ok: true,
            entries: [{ name: 'report.pdf', path: '/home/u/Downloads/report.pdf', type: 'file' }],
            truncated: false,
        });
        // Failing the transfer stops the hook before it hands anything to the browser.
        downloadDaemonSessionFileToDestinationMock.mockResolvedValue({ ok: false, error: 'stopped by test' });
        const setChrome = vi.fn();
        const { SharedFolderModal } = await import('./SharedFolderModal');

        const screen = await renderScreen(
            <SharedFolderModal
                sessionId="session-1"
                machineId="machine-1"
                serverId={null}
                location={{ absolutePath: '/home/u/Downloads', displayPath: '~/Downloads' }}
                onClose={vi.fn()}
                setChrome={setChrome}
            />,
        );
        await flushHookEffects({ cycles: 4, turns: 4 });

        expect(machineCreateDirectoryMock).toHaveBeenCalledWith('machine-1', '/home/u/Downloads', { serverId: null });
        expect(listMachineFileBrowserDirectoryEntriesMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            directoryPath: '/home/u/Downloads',
            includeFiles: true,
        }));
        expect(setChrome).toHaveBeenCalledWith(expect.objectContaining({
            title: 'files.sharedFolder.title',
            subtitle: '~/Downloads',
        }));

        await screen.pressByTestIdAsync(getPathBrowserRowTestId('/home/u/Downloads/report.pdf'));
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(downloadDaemonSessionFileToDestinationMock).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-1',
            request: { path: '/home/u/Downloads/report.pdf', asZip: false },
        }));
    });
});
