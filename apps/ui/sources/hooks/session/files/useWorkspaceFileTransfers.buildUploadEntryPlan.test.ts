import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/ops', () => ({
    sessionStatFile: vi.fn(async () => ({ success: true, exists: false })),
}));

describe('buildUploadEntryPlan', () => {
    it('detects duplicate target paths within a single upload batch', async () => {
        const { buildUploadEntryPlan } = await import('./useWorkspaceFileTransfers');

        const result = await buildUploadEntryPlan({
            sessionId: 's1',
            destinationDir: '',
            entries: [
                {
                    kind: 'native',
                    uri: 'file:///tmp/a.txt',
                    name: 'a.txt',
                    sizeBytes: 10,
                    mimeType: 'text/plain',
                    relativePath: 'a.txt',
                },
                {
                    kind: 'native',
                    uri: 'file:///tmp/other/a.txt',
                    name: 'a.txt',
                    sizeBytes: 20,
                    mimeType: 'text/plain',
                    relativePath: 'a.txt',
                },
            ],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const paths = result.tasks.map((t) => t.targetPath);
        expect(new Set(paths).size).toBe(paths.length);
    });
    it('uploads into an absolute folder on the machine when asked, keeping each relative path', async () => {
        const { buildUploadEntryPlan } = await import('./useWorkspaceFileTransfers');

        const result = await buildUploadEntryPlan({
            sessionId: 's1',
            destinationDir: '/home/u/Downloads/',
            destinationIsAbsolute: true,
            entries: [
                { kind: 'native', uri: 'file:///tmp/a.jpg', name: 'a.jpg', sizeBytes: 1, mimeType: 'image/jpeg', relativePath: 'photos/a.jpg' },
                { kind: 'native', uri: 'file:///tmp/b.txt', name: 'b.txt', sizeBytes: 2, mimeType: 'text/plain', relativePath: 'b.txt' },
                { kind: 'native', uri: 'file:///tmp/c.txt', name: 'c.txt', sizeBytes: 3, mimeType: 'text/plain', relativePath: '../c.txt' },
            ],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.tasks.map((task) => task.targetPath)).toEqual(['/home/u/Downloads/photos/a.jpg', '/home/u/Downloads/b.txt']);
    });

    it('keeps workspace uploads inside the workspace', async () => {
        const { buildUploadEntryPlan } = await import('./useWorkspaceFileTransfers');

        const result = await buildUploadEntryPlan({
            sessionId: 's1',
            destinationDir: '/home/u/Downloads',
            entries: [
                { kind: 'native', uri: 'file:///tmp/b.txt', name: 'b.txt', sizeBytes: 2, mimeType: 'text/plain', relativePath: 'b.txt' },
            ],
        });

        expect(result).toEqual({ ok: false, error: 'No valid files to upload' });
    });
});
