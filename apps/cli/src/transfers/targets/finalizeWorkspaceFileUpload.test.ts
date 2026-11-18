import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const actualRename = actual.rename;
    let callCount = 0;

    return {
        ...actual,
        rename: vi.fn(async (from: string, to: string) => {
            callCount += 1;
            if (callCount === 1) {
                const error = new Error('Cross-device link not permitted') as NodeJS.ErrnoException;
                error.code = 'EXDEV';
                throw error;
            }
            await actualRename(from, to);
        }),
    };
});

import { rename as renameMock } from 'node:fs/promises';

import { finalizeWorkspaceFileUpload } from './finalizeWorkspaceFileUpload';

describe('finalizeWorkspaceFileUpload', () => {
    it('finalizes staged uploads when rename crosses devices', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'happier-finalize-upload-'));
        const tempPath = join(workspace, '.staged-upload');
        const destinationPath = join(workspace, 'nested', 'file.txt');

        await writeFile(tempPath, 'hello\n', 'utf8');

        const result = await finalizeWorkspaceFileUpload({
            tempPath,
            destPath: destinationPath,
            destDisplayPath: 'nested/file.txt',
            overwrite: false,
            sizeBytes: 6,
        });

        expect(result).toEqual({
            success: true,
            path: 'nested/file.txt',
            sizeBytes: 6,
        });
        expect(await readFile(destinationPath, 'utf8')).toBe('hello\n');
        await expect(stat(tempPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(renameMock).toHaveBeenCalledTimes(2);

        await rm(workspace, { recursive: true, force: true });
    });

    it('keeps an upload out of a folder a computer shares here once that computer is gone', async () => {
        // The upload began while the share was mounted; by the end the computer "laptop" left ~/code, so it is a plain folder.
        const home = await mkdtemp(join(tmpdir(), 'happier-finalize-share-home-'));
        await mkdir(join(home, '.ssh'));
        await writeFile(join(home, '.ssh', 'authorized_keys'), `restrict,command="'/opt/piggercode' 'machine' 'shared-folders' 'serve' '--label' 'laptop' '--place' 'code'" `
            + 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9 piggercode-shared-folders:machine-1\n');
        const tempPath = join(home, '.staged-upload');
        await writeFile(tempPath, 'hello\n', 'utf8');
        const previousHome = process.env.HOME;
        process.env.HOME = home;
        try {
            const result = await finalizeWorkspaceFileUpload({
                tempPath,
                destPath: join(home, 'code', 'grad', 'photo.png'),
                destDisplayPath: '~/code/grad/photo.png',
                overwrite: false,
                sizeBytes: 6,
            });

            expect(result).toMatchObject({ success: false });
            expect(String((result as { error?: string }).error)).toContain('laptop');
            await expect(stat(join(home, 'code'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            process.env.HOME = previousHome;
            await rm(home, { recursive: true, force: true });
        }
    });
});
