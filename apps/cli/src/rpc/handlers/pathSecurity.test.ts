import { resolve } from 'path';
import { afterAll, describe, it, expect } from 'vitest';
import { validatePath, validateWorkspaceInspectionPath } from './pathSecurity';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('validatePath', () => {
    const workingRoot = mkdtempSync(join(tmpdir(), 'happier-pathSecurity-working-'));
    const workingDir = join(workingRoot, 'project');
    mkdirSync(workingDir, { recursive: true });
    const canonicalWorkingDir = realpathSync(workingDir);

    afterAll(() => {
        rmSync(workingRoot, { recursive: true, force: true });
    });

    it('should allow paths within working directory', async () => {
        expect(await validatePath(resolve(workingDir, 'file.txt'), workingDir)).toMatchObject({
            valid: true,
            resolvedPath: resolve(workingDir, 'file.txt'),
        });
        expect(await validatePath('file.txt', workingDir)).toMatchObject({
            valid: true,
            resolvedPath: resolve(canonicalWorkingDir, 'file.txt'),
        });
        expect(await validatePath('./src/file.txt', workingDir)).toMatchObject({
            valid: true,
            resolvedPath: resolve(canonicalWorkingDir, 'src', 'file.txt'),
        });
    });

    it('should reject paths outside working directory', async () => {
        const result = await validatePath('/etc/passwd', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the allowed directories');
    });

    it('should prevent path traversal attacks', async () => {
        const result = await validatePath('../../.ssh/id_rsa', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the allowed directories');
    });

    it('normalizes dot segments but still allows resolved in-root paths', async () => {
        const result = await validatePath('./src/../notes/todo.txt', workingDir);
        expect(result).toMatchObject({
            valid: true,
            resolvedPath: resolve(canonicalWorkingDir, 'notes', 'todo.txt'),
        });
    });

    it('rejects traversal after normalization when target resolves outside root', async () => {
        const result = await validatePath('./src/../../../outside.txt', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the allowed directories');
    });

    it('should allow the working directory itself', async () => {
        expect(await validatePath('.', workingDir)).toMatchObject({ valid: true, resolvedPath: canonicalWorkingDir });
        expect(await validatePath(workingDir, workingDir)).toMatchObject({ valid: true, resolvedPath: resolve(workingDir) });
    });

    it('allows paths inside additional allowed directories', async () => {
        const testBase = mkdtempSync(join(tmpdir(), 'happier-pathSecurity-extra-'));
        const extra = join(testBase, 'uploads');
        try {
            mkdirSync(extra, { recursive: true });
            expect((await validatePath(join(extra, 'session', 'file.jpg'), workingDir, [extra])).valid).toBe(true);
            expect((await validatePath(join(extra, 'abc', 'img.png'), workingDir, [extra])).valid).toBe(true);
        } finally {
            rmSync(testBase, { recursive: true, force: true });
        }
    });

    it('rejects traversal outside additional allowed directory', async () => {
        const testBase = mkdtempSync(join(tmpdir(), 'happier-pathSecurity-traversal-'));
        const extra = join(testBase, 'uploads');
        try {
            mkdirSync(extra, { recursive: true });
            const result = await validatePath(join(extra, '..', '..', 'etc', 'passwd'), workingDir, [extra]);
            expect(result.valid).toBe(false);
        } finally {
            rmSync(testBase, { recursive: true, force: true });
        }
    });

    it('prevents symlink traversal out of an allowed directory', async () => {
        const testBase = join(tmpdir(), `happier-pathSecurity-${Date.now()}`);
        const allowedDir = join(testBase, 'uploads');
        const outsideBase = join(tmpdir(), `happier-pathSecurity-outside-${Date.now()}`);
        const outsideDir = join(outsideBase, 'outside');
        const symlinkPath = join(allowedDir, 'evil-link');

        try {
            mkdirSync(allowedDir, { recursive: true });
            mkdirSync(outsideDir, { recursive: true });
            symlinkSync(outsideDir, symlinkPath);

            // The symlink resolves outside the working dir, so it must be rejected.
            const result = await validatePath(join(symlinkPath, 'secret.txt'), allowedDir);
            expect(result.valid).toBe(false);
        } finally {
            if (existsSync(testBase)) {
                rmSync(testBase, { recursive: true, force: true });
            }
            if (existsSync(outsideBase)) {
                rmSync(outsideBase, { recursive: true, force: true });
            }
        }
    });

    it('accepts paths that only differ by canonical realpath aliases', async () => {
        const testBase = join(tmpdir(), `happier-pathSecurity-canonical-${Date.now()}`);
        const realWorkspace = join(testBase, 'real-workspace');
        const aliasWorkspace = join(testBase, 'alias-workspace');

        try {
            mkdirSync(realWorkspace, { recursive: true });
            symlinkSync(realWorkspace, aliasWorkspace);

            const result = await validatePath(join(realWorkspace, 'notes.txt'), aliasWorkspace);
            expect(result).toMatchObject({
                valid: true,
                resolvedPath: join(realWorkspace, 'notes.txt'),
            });
        } finally {
            if (existsSync(testBase)) {
                rmSync(testBase, { recursive: true, force: true });
            }
        }
    });

    it('rejects when working directory is missing or invalid', async () => {
        expect(await validatePath('file.txt', '')).toEqual({
            valid: false,
            error: 'Access denied: Invalid working directory',
        });
        expect(await validatePath('file.txt', null as unknown as string)).toEqual({
            valid: false,
            error: 'Access denied: Invalid working directory',
        });
    });
});

describe('validateWorkspaceInspectionPath', () => {
    it('allows canonical absolute workspace inspection paths outside the working tree', async () => {
        expect(validateWorkspaceInspectionPath('/tmp/workspaces/demo')).toEqual({
            valid: true,
            resolvedPath: resolve('/tmp/workspaces/demo'),
        });
    });

    it('rejects relative workspace inspection paths', async () => {
        expect(validateWorkspaceInspectionPath('./demo')).toEqual({
            valid: false,
            error: 'Attached workspace candidate path must be absolute',
        });
    });

    it('rejects workspace inspection paths containing null bytes', async () => {
        expect(validateWorkspaceInspectionPath('/tmp/demo\0repo')).toEqual({
            valid: false,
            error: 'Attached workspace candidate path contains invalid characters',
        });
    });
});
