import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSharedFolderHealth, listSharedFolderMounts, type MountProbe } from './sharedFolderMounts';

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

describe('whether a path in a shared folder can be used now', () => {
  const home = '/home/u';
  const mountinfo = () => mountLine('/home/u/code', 'piggercode:laptop:code');
  /** A probe that answers as told; `hold` leaves it running, as a dead connection does, until `release`. */
  function probes(answer: boolean, hold = false) {
    const asked: string[] = [];
    let release = () => {};
    const probe = (path: string): MountProbe => {
      asked.push(path);
      return {
        answers: Promise.resolve(answer),
        exited: hold ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve(),
      };
    };
    return { asked, probe, release: () => release() };
  }

  it('asks nothing for a path outside the shared folders', async () => {
    const { asked, probe } = probes(false);
    const health = createSharedFolderHealth({ homeDir: () => home, readMountinfo: mountinfo, probe });

    expect(health.covers('/home/u/work/buff')).toBe(false);
    expect(health.covers('/home/u/code/app')).toBe(true);
    expect(await health.check('/home/u/work/buff')).toEqual({ inSharedFolder: false, problem: null });
    expect(asked).toEqual([]);
  });

  it('lets a path in a shared folder be used while that folder answers', async () => {
    const { asked, probe } = probes(true);
    const health = createSharedFolderHealth({ homeDir: () => home, readMountinfo: mountinfo, probe });

    expect(await health.check('/home/u/code/app')).toEqual({ inSharedFolder: true, problem: null });
    expect(asked).toEqual(['/home/u/code']);
  });

  it('names the computer when its folder does not answer, and asks no more while a probe is held', async () => {
    const { asked, probe, release } = probes(false, true);
    let now = 0;
    const health = createSharedFolderHealth({ homeDir: () => home, readMountinfo: mountinfo, probe, now: () => now });

    const first = await health.check('/home/u/code/app');
    now = 60_000;
    const later = await health.check('/home/u/code');

    expect(first.problem).toMatch(/~\/code is a folder the computer laptop shares here/);
    expect(later.problem).toBe(first.problem);
    expect(asked).toHaveLength(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await health.check('/home/u/code');
    expect(asked).toHaveLength(2);
  });

  it('asks a folder again only once its answer is 10 s old', async () => {
    const { asked, probe } = probes(true);
    let now = 0;
    const health = createSharedFolderHealth({ homeDir: () => home, readMountinfo: mountinfo, probe, now: () => now });

    await health.check('/home/u/code/a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 9_000;
    await health.check('/home/u/code/b');
    now = 11_000;
    await health.check('/home/u/code/c');

    expect(asked).toHaveLength(2);
  });
});
