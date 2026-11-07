import { describe, expect, it, vi } from 'vitest';

import {
    clearCachedMachineFileBrowserEntries,
    clearCachedMachineFileBrowserRoots,
    getCachedMachineFileBrowserEntries,
    getCachedMachineFileBrowserRoots,
    getMachineFileBrowserDirectoryState,
    listMachineFileBrowserDirectoryEntries,
    listMachineFileBrowserRoots,
    revalidateMachineFileBrowserDirectory,
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

    it('revalidates a directory quietly: readers hear only of a change, and a running listing goes first', async () => {
        const ops = await import('@/sync/ops/machineFileBrowser');
        const list = ops.machineFilesystemListDirectory as any;
        list.mockReset();
        clearCachedMachineFileBrowserEntries({ machineId: 'machine-3' });
        const target = { machineId: 'machine-3', serverId: 'server-1', directoryPath: '/home/u/work', includeFiles: false };
        const answer = (names: string[]) => ({
            ok: true,
            path: '/home/u/work',
            entries: names.map((name) => ({ name, path: `/home/u/work/${name}`, type: 'directory', modified: 1 })),
            truncated: false,
        });
        list.mockResolvedValueOnce(answer(['buff', 'servers']));
        await warmMachineFileBrowserDirectoryCache(target);
        const listener = vi.fn();
        const unsubscribe = subscribeMachineFileBrowserDirectories(listener);

        // Nothing changed on the machine: nobody is told, and no loading state shows.
        list.mockResolvedValueOnce(answer(['buff', 'servers']));
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(false);
        expect(listener).not.toHaveBeenCalled();

        // A folder went away there: readers are told once, with the new listing.
        list.mockResolvedValueOnce(answer(['servers']));
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getCachedMachineFileBrowserEntries(target)?.map((entry) => entry.name)).toEqual(['servers']);
        expect(getMachineFileBrowserDirectoryState(target)).toMatchObject({ loading: false, error: null });

        // A failure is told once while it stays the same, keeps the last listing, and its end is told too.
        list.mockResolvedValueOnce({ ok: false, error: "ENOENT: no such file or directory, scandir '/home/u/work'" });
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(true);
        list.mockResolvedValueOnce({ ok: false, error: "ENOENT: no such file or directory, scandir '/home/u/work'" });
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(false);
        expect(getMachineFileBrowserDirectoryState(target)).toMatchObject({ entries: [{ name: 'servers' }], error: expect.stringContaining('ENOENT') });
        list.mockResolvedValueOnce(answer(['servers']));
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(true);
        expect(getMachineFileBrowserDirectoryState(target)).toMatchObject({ error: null });
        expect(listener).toHaveBeenCalledTimes(3);

        // A request that fails on the way changes nothing.
        list.mockRejectedValueOnce(new Error('socket closed'));
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(false);

        // While a listing runs (a refresh, a folder opened), the revalidation stays out of its way.
        let finish!: (value: unknown) => void;
        list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const refresh = listMachineFileBrowserDirectoryEntries(target);
        const callsBefore = list.mock.calls.length;
        await expect(revalidateMachineFileBrowserDirectory(target)).resolves.toBe(false);
        expect(list.mock.calls.length).toBe(callsBefore);
        finish(answer(['servers', 'code']));
        await refresh;
        expect(getCachedMachineFileBrowserEntries(target)?.map((entry) => entry.name)).toEqual(['code', 'servers']);

        // An answer overtaken by a newer listing, or by a clear (a folder deleted), is dropped.
        for (const overtake of [
            async () => {
                list.mockResolvedValueOnce(answer(['code', 'new', 'servers']));
                await listMachineFileBrowserDirectoryEntries(target);
            },
            async () => {
                clearCachedMachineFileBrowserEntries({ machineId: 'machine-3', directoryPath: '/home/u/work' });
            },
        ]) {
            let late!: (value: unknown) => void;
            list.mockReturnValueOnce(new Promise((resolve) => { late = resolve; }));
            const stale = revalidateMachineFileBrowserDirectory(target);
            await overtake();
            const after = getCachedMachineFileBrowserEntries(target)?.map((entry) => entry.name) ?? null;
            late(answer(['old']));
            await expect(stale).resolves.toBe(false);
            expect(getCachedMachineFileBrowserEntries(target)?.map((entry) => entry.name) ?? null).toEqual(after);
            expect(after).not.toEqual(['old']);
        }
        unsubscribe();
    });
});

