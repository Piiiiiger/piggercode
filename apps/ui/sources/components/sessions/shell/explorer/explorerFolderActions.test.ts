import { afterEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@piggercode/protocol/rpc';

const machineRpc = vi.hoisted(() => vi.fn());

vi.mock('@/text', async () => {
    const { installTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return installTextModuleMock({ translate: (key: string) => key })();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
// The machine's RPC is the boundary; the folder actions, the machine operations and the listing cache run for real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => {
    const { installServerScopedMachineRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedMachineRpcModuleMock({ machineRpcWithServerScope: machineRpc })(importOriginal);
});

const code = { serverId: 's1', machineId: 'm1', path: '/home/u/code', homeDir: '/home/u' } as const;

async function load() {
    const { Modal } = await import('@/modal');
    const actions = await import('./explorerFolderActions');
    const browser = await import('@/sync/domains/input/machineFileBrowser');
    return { Modal: vi.mocked(Modal), browser, ...actions };
}

function rpcCalls(method: string) {
    return machineRpc.mock.calls.map(([request]) => request).filter((request) => request.method === method);
}

afterEach(async () => {
    const { browser } = await load();
    browser.clearCachedMachineFileBrowserEntries({ machineId: 'm1' });
    machineRpc.mockReset();
    vi.clearAllMocks();
});

describe('createExplorerFolder', () => {
    it('makes the named folder inside the folder and resolves to its path', async () => {
        const { Modal, createExplorerFolder } = await load();
        Modal.prompt.mockResolvedValueOnce(' notes ');
        machineRpc.mockResolvedValueOnce({ success: true });

        await expect(createExplorerFolder(code)).resolves.toBe('/home/u/code/notes');
        expect(rpcCalls(RPC_METHODS.CREATE_DIRECTORY)).toEqual([
            expect.objectContaining({ machineId: 'm1', serverId: 's1', payload: { path: '/home/u/code/notes' } }),
        ]);
        expect(Modal.alert).not.toHaveBeenCalled();
    });

    it('makes nothing when cancelled, for a name that leads elsewhere, for a folder already there, and says why it failed', async () => {
        const { Modal, browser, createExplorerFolder } = await load();
        Modal.prompt.mockResolvedValueOnce(null);
        await expect(createExplorerFolder(code)).resolves.toBeNull();

        Modal.prompt.mockResolvedValueOnce('../outside');
        await expect(createExplorerFolder(code)).resolves.toBeNull();
        expect(Modal.alert).toHaveBeenLastCalledWith('files.createFolderPromptTitle', 'sessionsList.explorerFolderNameInvalid');

        machineRpc.mockResolvedValueOnce({
            ok: true,
            path: code.path,
            entries: [{ name: 'grad', path: '/home/u/code/grad', type: 'directory' }],
            truncated: false,
        });
        await browser.listMachineFileBrowserDirectoryEntries({ machineId: 'm1', serverId: 's1', directoryPath: code.path, includeFiles: false });
        Modal.prompt.mockResolvedValueOnce('grad');
        await expect(createExplorerFolder(code)).resolves.toBeNull();
        expect(Modal.alert).toHaveBeenLastCalledWith('files.createFolderPromptTitle', 'sessionsList.explorerFolderExists');
        expect(rpcCalls(RPC_METHODS.CREATE_DIRECTORY)).toEqual([]);

        Modal.prompt.mockResolvedValueOnce('notes');
        machineRpc.mockResolvedValueOnce({ success: false, error: 'EACCES: permission denied' });
        await expect(createExplorerFolder(code)).resolves.toBeNull();
        expect(Modal.alert).toHaveBeenLastCalledWith('common.error', 'EACCES: permission denied');
    });
});

describe('deleteExplorerFolder', () => {
    type FolderSessions = Parameters<typeof import('./explorerFolderActions').deleteExplorerFolder>[1];
    type FakeSession = { id: string; active: boolean; metadata: { machineId: string; path: string }; owner?: string; accessLevel?: string };
    const session = (id: string, active: boolean, path = '/home/u/code/happier', extra: Partial<FakeSession> = {}): FakeSession => (
        { id, active, metadata: { machineId: 'm1', path }, ...extra }
    );
    /** The sessions as the store holds them; a stop the machine confirms ends the session there, as the server reports. */
    function folderWorld(...initial: FakeSession[]) {
        const sessions = [...initial];
        const calls: string[] = [];
        const read = (() => sessions) as unknown as FolderSessions;
        const ops = {
            stopSession: vi.fn(async (id: string): Promise<{ success: boolean; message?: string }> => {
                calls.push(`stop:${id}`);
                const found = sessions.find((entry) => entry.id === id);
                if (found) found.active = false;
                return { success: true };
            }),
            deleteSession: vi.fn(async (id: string): Promise<{ success: boolean; message?: string }> => {
                calls.push(`delete:${id}`);
                return { success: true };
            }),
        };
        return { sessions, calls, read, ops };
    }

    it('deletes the folder and the sessions started in it once confirmed', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', false), session('b', false, '/home/u/code'), session('elsewhere', false, '/home/u/notes'));
        Modal.confirm.mockResolvedValueOnce(false);
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(false);
        expect(machineRpc).not.toHaveBeenCalled();
        expect(world.calls).toEqual([]);

        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockImplementationOnce(async () => { world.calls.push('folder'); return { success: true }; });
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(true);
        expect(Modal.confirm).toHaveBeenLastCalledWith(
            'files.repositoryTree.deleteFolder.title',
            'files.repositoryTree.deleteFolder.body\n\nsessionsList.explorerDeleteFolderSessions',
            expect.objectContaining({ destructive: true }),
        );
        expect(rpcCalls(RPC_METHODS.DELETE_PATH)).toEqual([
            expect.objectContaining({ machineId: 'm1', serverId: 's1', payload: { path: '/home/u/code', recursive: true } }),
        ]);
        // The folder first, then its sessions; sessions elsewhere stay.
        expect(world.calls).toEqual(['folder', 'delete:a', 'delete:b']);
        expect(world.ops.deleteSession).toHaveBeenCalledWith('a', { serverId: 's1' });
        expect(Modal.alert).not.toHaveBeenCalled();
    });

    it('stops the sessions running in the folder before deleting anything', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('run', true), session('idle', false));
        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockImplementationOnce(async () => { world.calls.push('folder'); return { success: true }; });
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(true);
        expect(Modal.confirm).toHaveBeenLastCalledWith(
            'files.repositoryTree.deleteFolder.title',
            'files.repositoryTree.deleteFolder.body\n\nsessionsList.explorerDeleteFolderSessions sessionsList.explorerDeleteFolderRunning',
            expect.anything(),
        );
        expect(world.calls).toEqual(['stop:run', 'folder', 'delete:run', 'delete:idle']);
    });

    it('reads the sessions again after the confirmation, stopping one that started meanwhile', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', false));
        Modal.confirm.mockImplementationOnce(async () => {
            // While the dialog is open, the session is resumed and another one starts there.
            world.sessions[0]!.active = true;
            world.sessions.push(session('b', true, '/home/u/code/new'));
            return true;
        });
        machineRpc.mockImplementationOnce(async () => { world.calls.push('folder'); return { success: true }; });
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(true);
        expect(world.calls).toEqual(['stop:a', 'stop:b', 'folder', 'delete:a', 'delete:b']);
    });

    it('goes by the server for a session just stopped, though this device still shows it running', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', true));
        Modal.confirm.mockResolvedValue(true);
        // This device's copy stays active/connected (a snapshot), while the server has the session ended.
        const server = new Map<string, boolean>([['a', true]]);
        const ops = {
            ...world.ops,
            stopSession: vi.fn(async (id: string) => { world.calls.push(`stop:${id}`); server.set(id, false); return { success: true }; }),
            readServerActive: vi.fn(async (id: string) => server.get(id) ?? null),
        };
        machineRpc.mockImplementationOnce(async () => { world.calls.push('folder'); return { success: true }; });
        await expect(deleteExplorerFolder(code, world.read, { ops, waitMs: 30, pollMs: 5 })).resolves.toBe(true);
        expect(world.calls).toEqual(['stop:a', 'folder', 'delete:a']);
        expect(Modal.alert).not.toHaveBeenCalled();

        // The server says it runs again (resumed elsewhere): the folder stays, whatever this device shows.
        machineRpc.mockReset();
        world.calls.length = 0;
        server.set('a', true);
        const resumed = { ...ops, stopSession: vi.fn(async () => { server.set('a', true); return { success: true }; }) };
        await expect(deleteExplorerFolder(code, world.read, { ops: resumed, waitMs: 30, pollMs: 5 })).resolves.toBe(false);
        expect(machineRpc).not.toHaveBeenCalled();
        expect(world.calls).toEqual([]);
    });

    it('waits on the server, not on this device, when the machine accepts a stop that is still under way', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', true));
        Modal.confirm.mockResolvedValue(true);
        // The runner takes the stop and ends shortly; this device's copy keeps showing it running.
        const server = new Map<string, boolean>([['a', true]]);
        const ops = {
            ...world.ops,
            stopSession: vi.fn(async (id: string) => {
                world.calls.push(`stop:${id}`);
                setTimeout(() => server.set(id, false), 10);
                return { success: false, code: 'session_stop_requested', recovery: 'wait_for_inactive', message: 'Stop requested' } as const;
            }),
            readServerActive: vi.fn(async (id: string) => server.get(id) ?? null),
        };
        machineRpc.mockImplementationOnce(async () => { world.calls.push('folder'); return { success: true }; });
        await expect(deleteExplorerFolder(code, world.read, { ops, waitMs: 1_000, pollMs: 5 })).resolves.toBe(true);
        expect(world.calls).toEqual(['stop:a', 'folder', 'delete:a']);
        expect(Modal.alert).not.toHaveBeenCalled();
    });

    it('keeps the folder when a session starts in it while the server is asked about the one just stopped', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', true));
        Modal.confirm.mockResolvedValue(true);
        let answer: ((active: boolean) => void) | null = null;
        const ops = {
            ...world.ops,
            readServerActive: vi.fn(() => new Promise<boolean | null>((resolve) => { answer = resolve; })),
        };
        const deleting = deleteExplorerFolder(code, world.read, { ops, waitMs: 60, pollMs: 5 });
        await vi.waitFor(() => expect(answer).not.toBeNull());
        world.sessions.push(session('b', true));
        answer!(false);

        await expect(deleting).resolves.toBe(false);
        expect(machineRpc).not.toHaveBeenCalled();
        expect(world.calls).toEqual(['stop:a']);
    });

    it('keeps the folder when the server does not answer whether a stopped session has ended', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', true));
        Modal.confirm.mockResolvedValue(true);
        const ops = { ...world.ops, readServerActive: vi.fn(() => new Promise<boolean | null>(() => {})) };
        await expect(deleteExplorerFolder(code, world.read, { ops, waitMs: 30, pollMs: 5 })).resolves.toBe(false);
        expect(machineRpc).not.toHaveBeenCalled();
        expect(world.calls).toEqual(['stop:a']);
        expect(Modal.alert).toHaveBeenCalledWith(expect.any(String), 'sessionsList.explorerDeleteFolderStopFailed');
    });

    it('keeps the folder when a stopped session runs again before it goes', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', true), session('b', true));
        Modal.confirm.mockResolvedValueOnce(true);
        const stop = world.ops.stopSession;
        world.ops.stopSession = vi.fn(async (id: string): Promise<{ success: boolean; message?: string }> => {
            const result = await stop(id);
            // A is resumed (by another device) while B is being stopped.
            if (id === 'b') world.sessions[0]!.active = true;
            return result;
        });
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops, waitMs: 30, pollMs: 5 })).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('files.repositoryTree.deleteFolder.title', 'sessionsList.explorerDeleteFolderStopFailed');
        expect(machineRpc).not.toHaveBeenCalled();
        expect(world.calls).toEqual(['stop:a', 'stop:b']);
    });

    it('deletes nothing when a running session cannot be stopped', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('run', true));
        world.ops.stopSession = vi.fn(async (id: string): Promise<{ success: boolean; message?: string }> => {
            world.calls.push(`stop:${id}`);
            return { success: false, message: 'machine offline' };
        });
        Modal.confirm.mockResolvedValueOnce(true);
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('files.repositoryTree.deleteFolder.title', 'sessionsList.explorerDeleteFolderStopFailed');
        expect(world.calls).toEqual(['stop:run']);
        expect(machineRpc).not.toHaveBeenCalled();
    });

    it('deletes nothing once the sessions cannot be read for this server any more', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('run', true));
        let open = true;
        const read = (() => (open ? world.sessions : null)) as unknown as FolderSessions;
        Modal.confirm.mockImplementationOnce(async () => { open = false; return true; });
        await expect(deleteExplorerFolder(code, read, { ops: world.ops })).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('files.repositoryTree.deleteFolder.title', 'sessionsList.explorerDeleteFolderServerChanged');
        expect(world.calls).toEqual([]);
        expect(machineRpc).not.toHaveBeenCalled();
    });

    it('keeps the sessions when the folder could not be deleted, and says which sessions failed afterwards', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('a', false), session('b', false));
        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockResolvedValueOnce({ success: false, error: 'permission denied' });
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('common.error', 'permission denied');
        expect(world.calls).toEqual([]);

        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockResolvedValueOnce({ success: true });
        world.ops.deleteSession.mockResolvedValueOnce({ success: false, message: 'server said no' });
        await expect(deleteExplorerFolder(code, world.read, { ops: world.ops })).resolves.toBe(true);
        expect(Modal.alert).toHaveBeenLastCalledWith('files.repositoryTree.deleteFolder.title', 'sessionsList.explorerDeleteFolderSessionsFailed');
    });

    it('deletes only the sessions of a folder that is already gone', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld(session('run', true));
        Modal.confirm.mockResolvedValueOnce(true);
        await expect(deleteExplorerFolder(code, world.read, { missing: true, ops: world.ops })).resolves.toBe(true);
        expect(Modal.confirm).toHaveBeenLastCalledWith(
            'sessionsList.explorerDeleteMissingFolderTitle',
            'sessionsList.explorerDeleteMissingFolderBody sessionsList.explorerDeleteFolderRunning',
            expect.objectContaining({ confirmText: 'sessionInfo.deleteSession', destructive: true }),
        );
        expect(world.calls).toEqual(['stop:run', 'delete:run']);
        expect(machineRpc).not.toHaveBeenCalled();
    });

    it('refuses while a session there runs that cannot be stopped from here, and leaves stopped shared sessions alone', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const running = folderWorld(session('shared', true, '/home/u/code/happier', { owner: 'someone', accessLevel: 'edit' }));
        await expect(deleteExplorerFolder(code, running.read, { ops: running.ops })).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('files.repositoryTree.deleteFolder.title', 'sessionsList.explorerDeleteFolderBlocked');
        expect(Modal.confirm).not.toHaveBeenCalled();

        const stopped = folderWorld(session('shared', false, '/home/u/code/happier', { owner: 'someone', accessLevel: 'edit' }));
        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockResolvedValueOnce({ success: true });
        await expect(deleteExplorerFolder(code, stopped.read, { ops: stopped.ops })).resolves.toBe(true);
        expect(stopped.calls).toEqual([]);
    });

    it('never deletes the home folder or a folder holding it', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        const world = folderWorld();
        await expect(deleteExplorerFolder({ ...code, path: '/home/u' }, world.read, { ops: world.ops })).resolves.toBe(false);
        await expect(deleteExplorerFolder({ ...code, path: '/home' }, world.read, { ops: world.ops })).resolves.toBe(false);
        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(machineRpc).not.toHaveBeenCalled();
    });
});

describe('hydrateExplorerFolderSessions', () => {
    const folder = { serverId: 's1', machineId: 'm1', path: '/work/folder1', homeDir: null } as const;

    it('loads the listed sessions of the folder that the store does not hold yet, and nothing else', async () => {
        const { hydrateExplorerFolderSessions } = await load();
        const loaded = new Set(['a']);
        const load_ = vi.fn(async (id: string) => { loaded.add(id); });

        await hydrateExplorerFolderSessions(folder, {
            listedSessions: [
                { id: 'a', metadata: { machineId: 'm1', path: '/work/folder1' } },
                { id: 'b', metadata: { machineId: 'm1', path: '/work/folder1/sub' } },
                { id: 'elsewhere', metadata: { machineId: 'm1', path: '/work/other' } },
                { id: 'other-machine', metadata: { machineId: 'm2', path: '/work/folder1' } },
            ],
            isLoaded: (id) => loaded.has(id),
            load: load_,
        });

        expect(load_.mock.calls).toEqual([['b']]);
    });

    it('goes on when one session cannot be loaded', async () => {
        const { hydrateExplorerFolderSessions } = await load();
        const load_ = vi.fn(async (id: string) => { if (id === 'a') throw new Error('offline'); });
        await expect(hydrateExplorerFolderSessions(folder, {
            listedSessions: [
                { id: 'a', metadata: { machineId: 'm1', path: '/work/folder1' } },
                { id: 'b', metadata: { machineId: 'm1', path: '/work/folder1' } },
            ],
            isLoaded: () => false,
            load: load_,
        })).resolves.toBeUndefined();
        expect(load_).toHaveBeenCalledTimes(2);
    });
});

describe('renameExplorerFolder', () => {
    const notes = { ...code, path: '/home/u/code/notes' };

    it('renames the folder where it is once given a new name', async () => {
        const { Modal, renameExplorerFolder } = await load();
        Modal.prompt.mockResolvedValueOnce('journal');
        machineRpc.mockResolvedValueOnce({ success: true });

        await expect(renameExplorerFolder(notes, [])).resolves.toBe('/home/u/code/journal');
        expect(Modal.prompt).toHaveBeenLastCalledWith(
            'sessionsList.renameFolderPromptTitle',
            expect.any(String),
            expect.objectContaining({ defaultValue: 'notes' }),
        );
        expect(rpcCalls(RPC_METHODS.RENAME_PATH)).toEqual([
            expect.objectContaining({
                machineId: 'm1',
                serverId: 's1',
                payload: { from: '/home/u/code/notes', to: '/home/u/code/journal', overwrite: false },
            }),
        ]);
    });

    it('keeps the name while sessions started in the folder, for the same name and for a name with a path', async () => {
        const { Modal, renameExplorerFolder } = await load();
        const sessionsInside = [{ active: false, metadata: { machineId: 'm1', path: '/home/u/code/notes/app' } }];
        await expect(renameExplorerFolder(notes, sessionsInside)).resolves.toBeNull();
        expect(Modal.alert).toHaveBeenLastCalledWith('sessionsList.renameFolderPromptTitle', 'sessionsList.explorerRenameFolderHasSessions');
        expect(Modal.prompt).not.toHaveBeenCalled();

        Modal.prompt.mockResolvedValueOnce('notes');
        await expect(renameExplorerFolder(notes, [])).resolves.toBeNull();
        Modal.prompt.mockResolvedValueOnce('a/b');
        await expect(renameExplorerFolder(notes, [])).resolves.toBeNull();
        expect(Modal.alert).toHaveBeenLastCalledWith('sessionsList.renameFolderPromptTitle', 'sessionsList.explorerRenameFolderInvalid');
        expect(machineRpc).not.toHaveBeenCalled();
    });
});

describe('file actions', () => {
    const readme = { ...code, path: '/home/u/code/README.md' };

    it('renames a file where it is, and deletes it after a confirmation without touching folders', async () => {
        const { Modal, deleteExplorerFile, renameExplorerFile } = await load();
        Modal.prompt.mockResolvedValueOnce('NOTES.md');
        machineRpc.mockResolvedValueOnce({ success: true });
        await expect(renameExplorerFile(readme)).resolves.toBe('/home/u/code/NOTES.md');
        expect(rpcCalls(RPC_METHODS.RENAME_PATH)).toEqual([
            expect.objectContaining({ payload: { from: '/home/u/code/README.md', to: '/home/u/code/NOTES.md', overwrite: false } }),
        ]);

        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockResolvedValueOnce({ success: true });
        await expect(deleteExplorerFile(readme)).resolves.toBe(true);
        expect(Modal.confirm).toHaveBeenLastCalledWith(
            'files.repositoryTree.deleteFile.title',
            'files.repositoryTree.deleteFile.body',
            expect.objectContaining({ destructive: true }),
        );
        expect(rpcCalls(RPC_METHODS.DELETE_PATH)).toEqual([
            expect.objectContaining({ payload: { path: '/home/u/code/README.md', recursive: false } }),
        ]);
    });

    it('says why a download failed instead of saving anything', async () => {
        const { Modal, downloadExplorerFile } = await load();
        machineRpc.mockResolvedValueOnce({ success: false, error: 'File is too large to read' });
        await expect(downloadExplorerFile(readme)).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('common.error', 'File is too large to read');
        expect(rpcCalls(RPC_METHODS.READ_FILE)).toEqual([expect.objectContaining({ payload: { path: '/home/u/code/README.md' } })]);
    });
});
