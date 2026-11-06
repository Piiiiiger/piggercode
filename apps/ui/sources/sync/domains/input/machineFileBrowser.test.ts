import { describe, expect, it, vi } from 'vitest';

import {
    clearCachedMachineFileBrowserEntries,
    clearCachedMachineFileBrowserRoots,
    getCachedMachineFileBrowserEntries,
    getCachedMachineFileBrowserRoots,
    getMachineFileBrowserDirectoryState,
    listMachineFileBrowserDirectoryEntries,
    listMachineFileBrowserRoots,
    subscribeMachineFileBrowserDirectories,
    warmMachineFileBrowserDirectoryCache,
} from './machineFileBrowser';

vi.mock('@/sync/ops/machineFileBrowser', () => ({
    machineFilesystemListRoots: vi.fn(),
    machineFilesystemListDirectory: vi.fn(),
}));

describe('machineFileBrowser domain', () => {
    it('sorts and caches roots and directory entries', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListRoots as any).mockReset();
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-1' });
        (ops.machineFilesystemListRoots as any).mockResolvedValueOnce({
            ok: true,
            roots: [{ id: '/', label: '/', path: '/' }],
        });
        (ops.machineFilesystemListDirectory as any).mockResolvedValueOnce({
            ok: true,
            path: '/Users/leeroy',
            entries: [
                { name: 'b.txt', path: '/Users/leeroy/b.txt', type: 'file' },
                { name: 'A', path: '/Users/leeroy/A', type: 'directory' },
            ],
            truncated: false,
        });

        const roots = await listMachineFileBrowserRoots({ machineId: 'machine-1', serverId: 'server-1' });
        const directory = await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1',
            directoryPath: '/Users/leeroy',
            includeFiles: true,
            serverId: 'server-1',
        });

        expect(roots).toEqual({
            ok: true,
            roots: [{ id: '/', label: '/', path: '/' }],
        });
        expect(directory.ok).toBe(true);
        if (directory.ok) {
            expect(directory.entries.map((entry) => `${entry.type}:${entry.name}`)).toEqual([
                'directory:A',
                'file:b.txt',
            ]);
        }
        expect(getCachedMachineFileBrowserRoots({ machineId: 'machine-1', serverId: 'server-1' })).toEqual([{ id: '/', label: '/', path: '/' }]);
        expect(getCachedMachineFileBrowserEntries({ machineId: 'machine-1', serverId: 'server-1', directoryPath: '/Users/leeroy' })).not.toBeNull();
    });

    it('tells directory readers when a machine\'s roots change, and only then', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListRoots as any).mockReset();
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-roots' });
        // The roots a server answers with, a folder one of the user's computers shares with it among them.
        (ops.machineFilesystemListRoots as any).mockResolvedValue({
            ok: true,
            roots: [
                { id: '/', label: '/', path: '/' },
                { id: 'shared-folder:/home/u/local/mac/code', label: 'mac/code', path: '/home/u/local/mac/code', sharedFolder: { folder: 'code' } },
            ],
        });
        const listener = vi.fn();
        const unsubscribe = subscribeMachineFileBrowserDirectories(listener);
        try {
            await listMachineFileBrowserRoots({ machineId: 'machine-roots' });
            await listMachineFileBrowserRoots({ machineId: 'machine-roots' });
            expect(listener).toHaveBeenCalledTimes(1);

            // The share went away.
            (ops.machineFilesystemListRoots as any).mockResolvedValue({ ok: true, roots: [{ id: '/', label: '/', path: '/' }] });
            await listMachineFileBrowserRoots({ machineId: 'machine-roots' });
            expect(listener).toHaveBeenCalledTimes(2);
        } finally {
            unsubscribe();
        }
    });

    it('dedupes in-flight warm requests and clears machine-scoped caches independently', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-1' });
        let resolveDirectory!: (value: unknown) => void;
        (ops.machineFilesystemListDirectory as any).mockReturnValueOnce(new Promise((resolve) => {
            resolveDirectory = resolve;
        }));

        const first = warmMachineFileBrowserDirectoryCache({
            machineId: 'machine-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
        });
        const second = warmMachineFileBrowserDirectoryCache({
            machineId: 'machine-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
        });

        expect(ops.machineFilesystemListDirectory).toHaveBeenCalledTimes(1);

        resolveDirectory({
            ok: true,
            path: '/Users/leeroy',
            entries: [{ name: 'Documents', path: '/Users/leeroy/Documents', type: 'directory' }],
            truncated: false,
        });

        await first;
        await second;

        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });
        clearCachedMachineFileBrowserRoots({ machineId: 'machine-1' });

        expect(getCachedMachineFileBrowserEntries({ machineId: 'machine-1', directoryPath: '/Users/leeroy' })).toBeNull();
        expect(getCachedMachineFileBrowserRoots({ machineId: 'machine-1' })).toBeNull();
    });

    it('keeps machine browse caches isolated by server scope and preserves truncation in warm cache', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-1' });

        (ops.machineFilesystemListDirectory as any)
            .mockResolvedValueOnce({
                ok: true,
                path: '/Users/leeroy',
                entries: [{ name: 'Documents', path: '/Users/leeroy/Documents', type: 'directory' }],
                truncated: true,
            })
            .mockResolvedValueOnce({
                ok: true,
                path: '/Users/leeroy',
                entries: [{ name: 'Downloads', path: '/Users/leeroy/Downloads', type: 'directory' }],
                truncated: false,
            });

        const serverOne = await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1',
            serverId: 'server-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
        });
        const serverTwo = await listMachineFileBrowserDirectoryEntries({
            machineId: 'machine-1',
            serverId: 'server-2',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
        });

        const warmedServerOne = await warmMachineFileBrowserDirectoryCache({
            machineId: 'machine-1',
            serverId: 'server-1',
            directoryPath: '/Users/leeroy',
            includeFiles: false,
        });

        expect(serverOne).toEqual({
            ok: true,
            entries: [{ name: 'Documents', path: '/Users/leeroy/Documents', type: 'directory' }],
            truncated: true,
        });
        expect(serverTwo).toEqual({
            ok: true,
            entries: [{ name: 'Downloads', path: '/Users/leeroy/Downloads', type: 'directory' }],
            truncated: false,
        });
        expect(warmedServerOne).toEqual(serverOne);
        expect(ops.machineFilesystemListDirectory).toHaveBeenCalledTimes(2);
    });

    it('reports each directory as loading, listed or failed, keeps the last listing on failure and notifies subscribers', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        (ops.machineFilesystemListDirectory as any).mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-2' });
        const target = { machineId: 'machine-2', serverId: 'server-1', directoryPath: '/home/u', includeFiles: false };
        const listener = vi.fn();
        const unsubscribe = subscribeMachineFileBrowserDirectories(listener);

        expect(getMachineFileBrowserDirectoryState(target)).toBeNull();

        let resolveFirst!: (value: unknown) => void;
        (ops.machineFilesystemListDirectory as any).mockReturnValueOnce(new Promise((resolve) => {
            resolveFirst = resolve;
        }));
        const first = warmMachineFileBrowserDirectoryCache(target);
        expect(getMachineFileBrowserDirectoryState(target)).toEqual({ entries: null, truncated: false, loading: true, error: null });

        resolveFirst({
            ok: true,
            path: '/home/u',
            entries: [{ name: 'code', path: '/home/u/code', type: 'directory' }],
            truncated: false,
        });
        await first;
        expect(getMachineFileBrowserDirectoryState(target)).toEqual({
            entries: [{ name: 'code', path: '/home/u/code', type: 'directory' }],
            truncated: false,
            loading: false,
            error: null,
        });

        (ops.machineFilesystemListDirectory as any).mockResolvedValueOnce({ ok: false, error: 'machine offline' });
        await listMachineFileBrowserDirectoryEntries(target);
        expect(getMachineFileBrowserDirectoryState(target)).toMatchObject({
            entries: [{ name: 'code' }],
            loading: false,
            error: 'machine offline',
        });
        expect(listener).toHaveBeenCalled();

        clearCachedMachineFileBrowserEntries({ machineId: 'machine-2' });
        expect(getMachineFileBrowserDirectoryState(target)).toBeNull();
        const notifiedCount = listener.mock.calls.length;
        unsubscribe();
        (ops.machineFilesystemListDirectory as any).mockResolvedValueOnce({ ok: true, path: '/home/u', entries: [], truncated: false });
        await warmMachineFileBrowserDirectoryCache(target);
        expect(listener.mock.calls.length).toBe(notifiedCount);
    });
});

