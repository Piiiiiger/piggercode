import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateMachineBrowsePath } from './machineBrowsePathPolicy';

describe('validateMachineBrowsePath', () => {
  it('accepts absolute paths within the discovered roots', async () => {
    expect(await validateMachineBrowsePath({
      targetPath: '/Users/leeroy',
      roots: [{ id: '/', label: '/', path: '/' }],
      platform: 'darwin',
    })).toEqual({
      valid: true,
      resolvedPath: '/Users/leeroy',
    });
  });

  it('rejects relative paths and paths outside allowed windows roots', async () => {
    expect(await validateMachineBrowsePath({
      targetPath: 'relative/path',
      roots: [{ id: '/', label: '/', path: '/' }],
      platform: 'darwin',
    })).toMatchObject({ valid: false });

    expect(await validateMachineBrowsePath({
      targetPath: 'D:\\work',
      roots: [{ id: 'C:\\', label: 'C:', path: 'C:\\' }],
      platform: 'win32',
    })).toMatchObject({ valid: false });
  });

  it('accepts absolute Windows paths when the injected platform is win32', async () => {
    expect(await validateMachineBrowsePath({
      targetPath: 'C:\\Users\\alice\\repo',
      roots: [{ id: 'C:\\', label: 'C:', path: 'C:\\' }],
      platform: 'win32',
    })).toEqual({
      valid: true,
      resolvedPath: 'C:\\Users\\alice\\repo',
    });
  });

  it('does not realpath Windows paths through the host filesystem when the injected platform is win32', async () => {
    const previousCwd = process.cwd();
    const workspace = mkdtempSync(join(tmpdir(), 'happier-machine-browse-windows-'));
    const fakeWindowsPathOnHost = join(workspace, 'C:\\Users\\alice\\repo');
    mkdirSync(fakeWindowsPathOnHost, { recursive: true });

    try {
      process.chdir(workspace);

      expect(await validateMachineBrowsePath({
        targetPath: 'C:\\Users\\alice\\repo',
        roots: [{ id: 'C:\\', label: 'C:', path: 'C:\\' }],
        platform: 'win32',
      })).toEqual({
        valid: true,
        resolvedPath: 'C:\\Users\\alice\\repo',
      });
    } finally {
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('rejects symlinked directories that escape an allowed root', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'happier-machine-browse-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'happier-machine-browse-outside-'));

    try {
      const root = join(workspace, 'root');
      const linkPath = join(root, 'escape');
      mkdirSync(root, { recursive: true });
      symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

      expect(await validateMachineBrowsePath({
        targetPath: linkPath,
        roots: [{ id: 'root', label: 'Root', path: root }],
      })).toMatchObject({ valid: false });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
