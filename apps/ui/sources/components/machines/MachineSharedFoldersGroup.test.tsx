import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES, RPC_METHODS } from '@piggercode/protocol/rpc';
import { createRpcCallError } from '@piggercode/protocol/rpcErrors';
import type { FolderShare } from '@piggercode/protocol';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

const machineRpcMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const alertMock = vi.hoisted(() => vi.fn());
const pickFolderMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock();
});

vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).installTextModuleMock()());

vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).installModalModuleMock({
    spies: {
        confirm: (...args) => confirmMock(...args),
        alert: (...args) => alertMock(...args),
    },
})());

vi.mock('@/components/ui/lists/ItemGroup', async () => {
    const { createPassThroughModule } = await import('@/dev/testkit/mocks/components');
    return createPassThroughModule(['ItemGroup']);
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

// The folder the user picks in the machine's folder browser.
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: (params: unknown) => pickFolderMock(params),
}));

// The relay/socket transport is the boundary; the app's machine operations stay real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => {
    const { installServerScopedMachineRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedMachineRpcModuleMock({
        machineRpcWithServerScope: (params: unknown) => machineRpcMock(params) as never,
    })(importOriginal);
});

type MachineRpcCall = Readonly<{ machineId: string; method: string; payload: Readonly<{ folder?: string; serverMachineId?: string }> }>;

const SERVER = { id: 'machine-server', name: 'server' };

/** The laptop's daemon, answering the way its shared-folder handlers do. */
function connectLaptop(initial: Readonly<{ shares?: FolderShare[]; refuseAdd?: string }> = {}) {
    const laptop = { shares: [...(initial.shares ?? [])] };
    machineRpcMock.mockImplementation(async (call: MachineRpcCall) => {
        expect(call.machineId).toBe('machine-laptop');
        if (call.method === RPC_METHODS.DAEMON_FOLDER_SHARE_LIST) return { shares: laptop.shares };
        if (call.method === RPC_METHODS.DAEMON_FOLDER_SHARE_ADD) {
            if (initial.refuseAdd) return { ok: false, errorCode: 'server_refused', error: initial.refuseAdd };
            const folder = String(call.payload.folder).replace('/home/pigger/', '');
            laptop.shares.push({
                folder,
                serverMachineId: String(call.payload.serverMachineId),
                serverPath: `~/local/laptop/${folder}`,
                state: 'connecting',
            });
            return { ok: true, shares: laptop.shares };
        }
        if (call.method === RPC_METHODS.DAEMON_FOLDER_SHARE_REMOVE) {
            laptop.shares = laptop.shares.filter((share) => share.folder !== call.payload.folder);
            return { ok: true, shares: laptop.shares };
        }
        throw new Error(`unexpected machine call ${call.method}`);
    });
    return laptop;
}

async function renderGroup(options: Readonly<{ isOnline?: boolean; targets?: ReadonlyArray<{ id: string; name: string }> }> = {}) {
    const { MachineSharedFoldersGroup } = await import('./MachineSharedFoldersGroup');
    const screen = await renderScreen(
        <MachineSharedFoldersGroup
            machineId="machine-laptop"
            isOnline={options.isOnline ?? true}
            serverId="relay-a"
            homeDir="/home/pigger"
            targets={options.targets ?? [SERVER]}
        />,
    );
    await flushHookEffects({ cycles: 8 });
    return {
        add: () => screen.findByTestId('machine-shared-folders-add'),
        share: (folder: string) => screen.findByTestId(`machine-shared-folder:${folder}`),
        press: async (testId: string) => {
            act(() => {
                screen.findByTestId(testId)?.props.onPress();
            });
            await flushHookEffects({ cycles: 12 });
        },
    };
}

const calledMethods = () => machineRpcMock.mock.calls.map(([call]) => (call as MachineRpcCall).method);

describe('MachineSharedFoldersGroup', () => {
    afterEach(() => {
        standardCleanup();
        vi.useRealTimers();
        machineRpcMock.mockReset();
        confirmMock.mockReset();
        alertMock.mockReset();
        pickFolderMock.mockReset();
    });

    it('shares a folder the user picks, after saying what the other machine gets', async () => {
        const laptop = connectLaptop();
        pickFolderMock.mockResolvedValue('/home/pigger/code');
        confirmMock.mockResolvedValue(true);
        const group = await renderGroup();
        expect(group.add()?.props.disabled).toBe(false);
        expect(group.add()?.props.subtitle).toBe('machine.sharedFolders.addSubtitle');

        await group.press('machine-shared-folders-add');

        expect(pickFolderMock).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-laptop', initialPath: '/home/pigger' }));
        expect(confirmMock).toHaveBeenCalledWith(
            { key: 'machine.sharedFolders.confirmTitle', params: { folder: '~/code', machine: 'server' } },
            { key: 'machine.sharedFolders.confirmBody', params: { folder: '~/code', machine: 'server' } },
            { confirmText: 'machine.sharedFolders.confirmAction' },
        );
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_FOLDER_SHARE_ADD,
            payload: { folder: '/home/pigger/code', serverMachineId: 'machine-server' },
        }));
        expect(laptop.shares).toHaveLength(1);
        expect(group.share('code')?.props.title).toBe('~/code');
        expect(group.share('code')?.props.subtitle).toEqual({ key: 'machine.sharedFolders.connecting', params: { machine: 'server' } });
    });

    it('shares nothing when the user backs out of the folder or the confirmation', async () => {
        connectLaptop();
        const group = await renderGroup();

        pickFolderMock.mockResolvedValue(null);
        await group.press('machine-shared-folders-add');
        pickFolderMock.mockResolvedValue('/home/pigger/code');
        confirmMock.mockResolvedValue(false);
        await group.press('machine-shared-folders-add');

        expect(calledMethods()).not.toContain(RPC_METHODS.DAEMON_FOLDER_SHARE_ADD);
    });

    it('passes on why the folder was not shared, in the machine’s words', async () => {
        connectLaptop({ refuseAdd: 'sshfs is not installed there.' });
        pickFolderMock.mockResolvedValue('/home/pigger/code');
        confirmMock.mockResolvedValue(true);
        const group = await renderGroup();

        await group.press('machine-shared-folders-add');

        expect(alertMock).toHaveBeenCalledWith('machine.sharedFolders.addFailedTitle', 'sshfs is not installed there.');
        expect(group.share('code')).toBeFalsy();
    });

    it('stops sharing after the user confirms', async () => {
        const laptop = connectLaptop({
            shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/local/laptop/code', state: 'connected' }],
        });
        confirmMock.mockResolvedValue(true);
        const group = await renderGroup();
        expect(group.share('code')?.props.subtitle).toEqual({
            key: 'machine.sharedFolders.connected',
            params: { machine: 'server', path: '~/local/laptop/code' },
        });

        await group.press('machine-shared-folder:code');

        expect(confirmMock).toHaveBeenCalledWith(
            { key: 'machine.sharedFolders.stopTitle', params: { folder: '~/code' } },
            { key: 'machine.sharedFolders.stopBody', params: { machine: 'server' } },
            { confirmText: 'machine.sharedFolders.stopAction', destructive: true },
        );
        expect(laptop.shares).toEqual([]);
        expect(group.share('code')).toBeFalsy();
    });

    it('follows a share while it connects, and stops asking once it is connected', async () => {
        vi.useFakeTimers();
        const laptop = connectLaptop({
            shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/local/laptop/code', state: 'connecting' }],
        });
        const group = await renderGroup();

        laptop.shares = [{ ...laptop.shares[0]!, state: 'retrying', error: 'Connection refused' }];
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(group.share('code')?.props.subtitle).toEqual({
            key: 'machine.sharedFolders.retrying',
            params: { machine: 'server', reason: 'Connection refused' },
        });

        laptop.shares = [{ ...laptop.shares[0]!, state: 'connected', error: undefined }];
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(group.share('code')?.props.subtitle).toEqual({
            key: 'machine.sharedFolders.connected',
            params: { machine: 'server', path: '~/local/laptop/code' },
        });

        const listCalls = calledMethods().filter((method) => method === RPC_METHODS.DAEMON_FOLDER_SHARE_LIST).length;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });
        expect(calledMethods().filter((method) => method === RPC_METHODS.DAEMON_FOLDER_SHARE_LIST).length).toBe(listCalls);
    });

    it('explains why a folder cannot be shared: offline, too old, unsupported, or no other machine', async () => {
        connectLaptop();
        const offline = await renderGroup({ isOnline: false });
        expect(machineRpcMock).not.toHaveBeenCalled();
        expect(offline.add()?.props.disabled).toBe(true);
        expect(offline.add()?.props.subtitle).toBe('machine.sharedFolders.offline');
        standardCleanup();

        machineRpcMock.mockRejectedValue(createRpcCallError({ error: 'RPC method not available', errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE }));
        const old = await renderGroup();
        expect(old.add()?.props.disabled).toBe(true);
        expect(old.add()?.props.subtitle).toBe('machine.sharedFolders.unavailable');
        standardCleanup();

        machineRpcMock.mockReset();
        machineRpcMock.mockResolvedValue({ shares: [], unsupported: 'Sharing folders works on Linux computers for now.' });
        const mac = await renderGroup();
        expect(mac.add()?.props.disabled).toBe(true);
        expect(mac.add()?.props.subtitle).toEqual({
            key: 'machine.sharedFolders.unsupported',
            params: { reason: 'Sharing folders works on Linux computers for now.' },
        });
        standardCleanup();

        connectLaptop();
        const alone = await renderGroup({ targets: [] });
        expect(alone.add()?.props.disabled).toBe(true);
        expect(alone.add()?.props.subtitle).toBe('machine.sharedFolders.noOtherMachine');
    });

    it('asks which machine to share with when there is more than one', async () => {
        connectLaptop();
        pickFolderMock.mockResolvedValue('/home/pigger/code');
        confirmMock.mockResolvedValue(true);
        alertMock.mockImplementation((_title: unknown, _body: unknown, buttons?: Array<{ text: string; onPress?: () => void }>) => {
            buttons?.find((button) => button.text === 'mac')?.onPress?.();
        });
        const group = await renderGroup({ targets: [SERVER, { id: 'machine-mac', name: 'mac' }] });

        await group.press('machine-shared-folders-add');

        expect(alertMock).toHaveBeenCalledWith('machine.sharedFolders.chooseMachineTitle', 'machine.sharedFolders.chooseMachineBody', expect.any(Array));
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_FOLDER_SHARE_ADD,
            payload: { folder: '/home/pigger/code', serverMachineId: 'machine-mac' },
        }));
    });
});
