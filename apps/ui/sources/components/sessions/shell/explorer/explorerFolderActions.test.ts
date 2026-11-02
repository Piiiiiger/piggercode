import { afterEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

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
    const sessionsIn = (active: boolean) => [{ active, metadata: { machineId: 'm1', path: '/home/u/code/happier' } }];

    it('deletes the folder with what it holds once confirmed, and says that sessions started there', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        Modal.confirm.mockResolvedValueOnce(false);
        await expect(deleteExplorerFolder(code, sessionsIn(false))).resolves.toBe(false);
        expect(machineRpc).not.toHaveBeenCalled();

        Modal.confirm.mockResolvedValueOnce(true);
        machineRpc.mockResolvedValueOnce({ success: true });
        await expect(deleteExplorerFolder(code, sessionsIn(false))).resolves.toBe(true);
        expect(Modal.confirm).toHaveBeenLastCalledWith(
            'files.repositoryTree.deleteFolder.title',
            'files.repositoryTree.deleteFolder.body\n\nsessionsList.explorerDeleteFolderSessions',
            expect.objectContaining({ destructive: true }),
        );
        expect(rpcCalls(RPC_METHODS.DELETE_PATH)).toEqual([
            expect.objectContaining({ machineId: 'm1', serverId: 's1', payload: { path: '/home/u/code', recursive: true } }),
        ]);
    });

    it('keeps the folder while a session runs in it, and never deletes the home folder or a folder holding it', async () => {
        const { Modal, deleteExplorerFolder } = await load();
        await expect(deleteExplorerFolder(code, sessionsIn(true))).resolves.toBe(false);
        expect(Modal.alert).toHaveBeenLastCalledWith('files.repositoryTree.deleteFolder.title', 'sessionsList.explorerDeleteFolderRunning');

        await expect(deleteExplorerFolder({ ...code, path: '/home/u' }, [])).resolves.toBe(false);
        await expect(deleteExplorerFolder({ ...code, path: '/home' }, [])).resolves.toBe(false);
        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(machineRpc).not.toHaveBeenCalled();
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
