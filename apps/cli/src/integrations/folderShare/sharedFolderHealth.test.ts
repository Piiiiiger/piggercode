import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSharedFolderHealth } from './sharedFolderHealth';
import type { MountProbe } from './sharedFolderMounts';

/** A mount table line as Linux writes it: the mount point by its real path, octal escapes for spaces. */
function mountLine(path: string, source: string, type = 'fuse.sshfs'): string {
  return `91 30 0:52 / ${path.replace(/ /g, '\\040')} rw,nosuid,nodev,relatime shared:2 - ${type} ${source} rw,user_id=1000,group_id=1000`;
}

/** The authorized_keys line by which this server lets a computer mount a folder at `place` (`acceptedComputers.ts`). */
function shareLine(label: string, place: string): string {
  return `restrict,command="'/opt/piggercode' 'machine' 'shared-folders' 'serve' '--label' '${label}' '--place' '${place}'" `
    + `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9 piggercode-shared-folders:machine-1\n`;
}

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

  it('reads a path as written, with `..`, `.` and repeated or trailing slashes resolved', async () => {
    const { asked, probe } = probes(true);
    const health = createSharedFolderHealth({ homeDir: () => home, readMountinfo: mountinfo, probe });

    for (const path of ['/home/u/work/../code/app', '/home/u/./code', '/home/u//code/', '/home/u/code/app/']) {
      expect(health.covers(path)).toBe(true);
    }
    expect(health.covers('/home/u/code/../work')).toBe(false);
    expect(health.covers('/home/u/codex')).toBe(false);
    expect(await health.check('/home/u/work/../code/app')).toEqual({ inSharedFolder: true, problem: null });
    expect(asked).toEqual(['/home/u/code']);
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

  it('counts a place a computer may mount a folder at as that folder while nothing is mounted there', async () => {
    const { asked, probe } = probes(true);
    const health = createSharedFolderHealth({
      homeDir: () => home,
      readMountinfo: () => '',
      readAuthorizedKeys: () => shareLine('laptop', 'code'),
      probe,
    });

    for (const path of ['/home/u/code', '/home/u/code/app', '/home/u/code/app/src']) {
      expect(health.covers(path)).toBe(true);
    }
    expect(health.covers('/home/u/codex')).toBe(false);
    expect(health.covers('/home/u/work/buff')).toBe(false);
    const { inSharedFolder, problem } = await health.check('/home/u/code/app');
    // Refused, naming the place and the computer; nothing touched, since nothing is mounted there to ask.
    expect(inSharedFolder).toBe(true);
    expect(problem).toContain('~/code');
    expect(problem).toContain('laptop');
    expect(asked).toEqual([]);
    expect(await health.check('/home/u/work/buff')).toEqual({ inSharedFolder: false, problem: null });
  });

  it('knows the place also by the home\'s real path, where the home is reached through a symbolic link', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piggercode-shared-health-'));
    try {
      mkdirSync(join(root, 'real'));
      const real = realpathSync(join(root, 'real'));
      const linkedHome = join(root, 'home');
      symlinkSync(real, linkedHome);
      const health = createSharedFolderHealth({
        homeDir: () => linkedHome,
        readMountinfo: () => '',
        readAuthorizedKeys: () => shareLine('laptop', 'code'),
      });

      expect(health.covers(join(real, 'code', 'grad'))).toBe(true);
      expect((await health.check(join(real, 'code', 'grad'))).problem).toContain('~/code');
      expect(health.covers(join(real, 'work'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('asks the folder itself once it is mounted at its place', async () => {
    const { asked, probe } = probes(true);
    const health = createSharedFolderHealth({
      homeDir: () => home,
      readMountinfo: mountinfo,
      readAuthorizedKeys: () => shareLine('laptop', 'code'),
      probe,
    });

    expect(await health.check('/home/u/code/app')).toEqual({ inSharedFolder: true, problem: null });
    expect(asked).toEqual(['/home/u/code']);
  });
});
