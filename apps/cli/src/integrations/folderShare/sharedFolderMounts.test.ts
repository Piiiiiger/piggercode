import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listSharedFolderMounts, probeMount, readMountProbeResult } from './sharedFolderMounts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A mount table line as Linux writes it: the mount point by its real path, octal escapes for spaces. */
function mountLine(path: string, source: string, type = 'fuse.sshfs'): string {
  return `91 30 0:52 / ${path.replace(/ /g, '\\040')} rw,nosuid,nodev,relatime shared:2 - ${type} ${source} rw,user_id=1000,group_id=1000`;
}

describe('the shared folders mounted on this server', () => {
  it('names them by the home as named, also where the home is reached through a symbolic link', () => {
    const root = mkdtempSync(join(tmpdir(), 'piggercode-shared-mounts-'));
    roots.push(root);
    mkdirSync(join(root, 'real'));
    const real = realpathSync(join(root, 'real'));
    const home = join(root, 'home');
    symlinkSync(real, home);
    const mountinfo = [
      mountLine(join(real, 'my code'), 'piggercode:laptop:code%2Fmy%20app'),
      mountLine(join(real, 'local', 'desk', 'notes'), 'desk:/notes'),
      mountLine(join(root, 'elsewhere'), 'piggercode:laptop:x'),
      mountLine(join(real, 'data'), '/dev/sdb1', 'ext4'),
    ].join('\n');

    expect(listSharedFolderMounts(home, mountinfo)).toEqual([
      { path: join(home, 'my code'), label: 'laptop', folder: 'code/my app', device: '0:52' },
      { path: join(home, 'local', 'desk', 'notes'), label: 'desk', folder: 'notes', device: '0:52' },
    ]);
  });
});

describe('asking a mount a question only the computer can answer', () => {
  it('takes a missing name as an answer, EIO as no connection, and ENOTCONN as nothing serving the mount', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piggercode-probe-'));
    roots.push(root);

    // A real `stat` of a name nothing creates, in a folder that answers.
    expect(await probeMount(root)).toBe('answers');
    // What `stat` says in the C locale when sshfs has no connection, or the mount has nobody behind it.
    expect(readMountProbeResult(1, "stat: cannot statx '/home/u/code/.piggercode-probe-1': Input/output error\n")).toBe('disconnected');
    expect(readMountProbeResult(1, "stat: cannot statx '/home/u/code/.piggercode-probe-1': Transport endpoint is not connected\n")).toBe('dead');
    // A folder may be named like an error: only what follows the quoted path counts.
    expect(readMountProbeResult(1, "stat: cannot statx '/home/u/Transport endpoint is not connected/.piggercode-probe-1': No such file or directory\n")).toBe('answers');
    // A path with a quote in it is put in double quotes.
    expect(readMountProbeResult(1, `stat: cannot statx "/home/o'brien/code/.piggercode-probe-ab12": Input/output error\n`)).toBe('disconnected');
  });
});
