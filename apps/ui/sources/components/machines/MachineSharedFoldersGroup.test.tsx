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
const promptMock = vi.hoisted(() => vi.fn());
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
        prompt: (...args) => promptMock(...args),
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

type MachineRpcCall = Readonly<{ machineId: string; method: string; payload: Readonly<{ folder?: string; serverMachineId?: string; at?: string }> }>;

const SERVER = { id: 'machine-server', name: 'server' };

/** The laptop's daemon, answering the way its shared-folder handlers do. */
function connectLaptop(initial: Readonly<{
    shares?: FolderShare[];
    refuseAdd?: string;
    ignoresPlace?: boolean;
    /** Folders the computer reaches through a symbolic link, by the name it resolves them to. */
    links?: Readonly<Record<string, string>>;
}> = {}) {
    const laptop = { shares: [...(initial.shares ?? [])] };
    machineRpcMock.mockImplementation(async (call: MachineRpcCall) => {
        expect(call.machineId).toBe('machine-laptop');
        if (call.method === RPC_METHODS.DAEMON_FOLDER_SHARE_LIST) return { shares: laptop.shares };
        if (call.method === RPC_METHODS.DAEMON_FOLDER_SHARE_ADD) {
            if (initial.refuseAdd) return { ok: false, errorCode: 'server_refused', error: initial.refuseAdd };
            const picked = String(call.payload.folder).replace('/home/pigger/', '');
            const folder = initial.links?.[picked] ?? picked;
            // As the computer reads a place (trimmed, no trailing slashes or `~/`); one from before places
            // ignores it: it shares under ~/local and moves nothing.
            const place = String(call.payload.at ?? folder).trim().replace(/\/+$/, '').replace(/^~\//, '');
            const serverPath = initial.ignoresPlace ? `~/local/laptop/${folder}` : `~/${place}`;
            const existing = laptop.shares.find((share) => share.folder === folder);
            if (existing) {
                if (!initial.ignoresPlace) laptop.shares = laptop.shares.map((share) => (share === existing ? { ...share, serverPath } : share));
                return { ok: true, shares: laptop.shares };
            }
            laptop.shares.push({ folder, serverMachineId: String(call.payload.serverMachineId), serverPath, state: 'connecting' });
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

/** The share's menu (`Modal.alert` with its actions): the user picks the action named `text`. */
function choose(text: string) {
    alertMock.mockImplementation((_title: unknown, _message: unknown, buttons?: ReadonlyArray<{ text: unknown; onPress?: () => void }>) => {
        buttons?.find((button) => button.text === text)?.onPress?.();
    });
}

describe('MachineSharedFoldersGroup', () => {
    afterEach(() => {
        standardCleanup();
        vi.useRealTimers();
        machineRpcMock.mockReset();
        confirmMock.mockReset();
        alertMock.mockReset();
        promptMock.mockReset();
        pickFolderMock.mockReset();
    });

    it('shares a folder the user picks where the user places it on the other machine, its own name by default', async () => {
        const laptop = connectLaptop();
        pickFolderMock.mockResolvedValue('/home/pigger/code');
        promptMock.mockResolvedValue('~/code');
        const group = await renderGroup();
        expect(group.add()?.props.disabled).toBe(false);
        expect(group.add()?.props.subtitle).toBe('machine.sharedFolders.addSubtitle');

        await group.press('machine-shared-folders-add');

        expect(pickFolderMock).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'machine-laptop', initialPath: '/home/pigger' }));
        expect(promptMock).toHaveBeenCalledWith(
            { key: 'machine.sharedFolders.confirmTitle', params: { folder: '~/code', machine: 'server' } },
            { key: 'machine.sharedFolders.confirmBody', params: { folder: '~/code', machine: 'server' } },
            { defaultValue: '~/code', confirmText: 'machine.sharedFolders.confirmAction' },
        );
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_FOLDER_SHARE_ADD,
            payload: { folder: '/home/pigger/code', serverMachineId: 'machine-server', at: '~/code' },
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
        promptMock.mockResolvedValue(null);
        await group.press('machine-shared-folders-add');

        expect(calledMethods()).not.toContain(RPC_METHODS.DAEMON_FOLDER_SHARE_ADD);
    });

    it('passes on why the folder was not shared, in the machine’s words', async () => {
        connectLaptop({ refuseAdd: 'sshfs is not installed there.' });
        pickFolderMock.mockResolvedValue('/home/pigger/code');
        promptMock.mockResolvedValue('~/code');
        const group = await renderGroup();

        await group.press('machine-shared-folders-add');

        expect(alertMock).toHaveBeenCalledWith('machine.sharedFolders.addFailedTitle', 'sshfs is not installed there.');
        expect(group.share('code')).toBeFalsy();
    });

    it('stops sharing after the user confirms', async () => {
        const laptop = connectLaptop({
            shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/code', state: 'connected' }],
        });
        confirmMock.mockResolvedValue(true);
        choose('machine.sharedFolders.stopAction');
        const group = await renderGroup();
        expect(group.share('code')?.props.subtitle).toEqual({
            key: 'machine.sharedFolders.connected',
            params: { machine: 'server', path: '~/code' },
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

    it('moves a share to where the user names it on the other machine', async () => {
        const laptop = connectLaptop({
            shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/code', state: 'connected' }],
        });
        choose('machine.sharedFolders.moveAction');
        promptMock.mockResolvedValue('~/projects/code/');
        const group = await renderGroup();

        await group.press('machine-shared-folder:code');

        expect(promptMock).toHaveBeenCalledWith(
            { key: 'machine.sharedFolders.moveTitle', params: { folder: '~/code' } },
            { key: 'machine.sharedFolders.placeBody', params: { machine: 'server' } },
            { defaultValue: '~/code', confirmText: 'machine.sharedFolders.moveConfirm' },
        );
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_FOLDER_SHARE_ADD,
            payload: { folder: 'code', serverMachineId: 'machine-server', at: '~/projects/code/' },
        }));
        expect(laptop.shares[0]!.serverPath).toBe('~/projects/code');
        expect(calledMethods()).not.toContain(RPC_METHODS.DAEMON_FOLDER_SHARE_REMOVE);
        expect(alertMock).not.toHaveBeenCalledWith('machine.sharedFolders.placeIgnoredTitle', expect.anything());
    });

    it('says so when a computer too old to place shares puts a new one under ~/local', async () => {
        // Picked through a link: the computer names the folder by what it resolves to.
        connectLaptop({ ignoresPlace: true, links: { 'code-link': 'code' } });
        pickFolderMock.mockResolvedValue('/home/pigger/code-link');
        promptMock.mockResolvedValue('~/code');
        const group = await renderGroup();

        await group.press('machine-shared-folders-add');

        expect(alertMock).toHaveBeenCalledWith('machine.sharedFolders.placeIgnoredTitle', {
            key: 'machine.sharedFolders.placeIgnoredBody',
            params: { place: '~/code', actual: '~/local/laptop/code' },
        });
    });

    it('reads the place as the computer does, so a valid one is never taken for an old computer', async () => {
        connectLaptop({ shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/code', state: 'connected' }] });
        choose('machine.sharedFolders.moveAction');
        promptMock.mockResolvedValue('  ~/work /');
        const group = await renderGroup();

        await group.press('machine-shared-folder:code');

        expect(alertMock).not.toHaveBeenCalledWith('machine.sharedFolders.placeIgnoredTitle', expect.anything());
    });

    it('says so when the computer is too old to put the folder where the user chose', async () => {
        connectLaptop({
            shares: [{ folder: 'code', serverMachineId: 'machine-server', serverPath: '~/local/laptop/code', state: 'connected' }],
            ignoresPlace: true,
        });
        choose('machine.sharedFolders.moveAction');
        promptMock.mockResolvedValue('~/code');
        const group = await renderGroup();

        await group.press('machine-shared-folder:code');

        expect(alertMock).toHaveBeenCalledWith('machine.sharedFolders.placeIgnoredTitle', {
            key: 'machine.sharedFolders.placeIgnoredBody',
            params: { place: '~/code', actual: '~/local/laptop/code' },
        });
    });

    it('suggests the folder\'s own name beside the server\'s folders when moving a share from under ~/local', async () => {
        connectLaptop({
            shares: [{ folder: 'work/code', serverMachineId: 'machine-server', serverPath: '~/local/laptop/work/code', state: 'connected' }],
        });
        choose('machine.sharedFolders.moveAction');
        promptMock.mockResolvedValue(null);
        const group = await renderGroup();

        await group.press('machine-shared-folder:work/code');

        expect(promptMock.mock.calls[0]![2]).toMatchObject({ defaultValue: '~/code' });
        expect(calledMethods()).not.toContain(RPC_METHODS.DAEMON_FOLDER_SHARE_ADD);
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
        promptMock.mockResolvedValue('~/code');
        alertMock.mockImplementation((_title: unknown, _body: unknown, buttons?: Array<{ text: string; onPress?: () => void }>) => {
            buttons?.find((button) => button.text === 'mac')?.onPress?.();
        });
        const group = await renderGroup({ targets: [SERVER, { id: 'machine-mac', name: 'mac' }] });

        await group.press('machine-shared-folders-add');

        expect(alertMock).toHaveBeenCalledWith('machine.sharedFolders.chooseMachineTitle', 'machine.sharedFolders.chooseMachineBody', expect.any(Array));
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            method: RPC_METHODS.DAEMON_FOLDER_SHARE_ADD,
            payload: { folder: '/home/pigger/code', serverMachineId: 'machine-mac', at: '~/code' },
        }));
    });
});
