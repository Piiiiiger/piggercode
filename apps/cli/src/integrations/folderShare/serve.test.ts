import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runSharedFoldersServe, type SharedFoldersServeSystem } from './serve';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-serve-'));
  homes.push(home);
  return home;
}

/** The OS side of a mount: mountinfo, sshfs and fusermount, recorded instead of run. */
function createSystem(options: Readonly<{ mounted?: string; mountAnswers?: boolean; abortFails?: string; onUnmount?: () => void }> = {}) {
  const calls: { sshfs: string[][]; unmounted: string[]; errors: string[]; steps: string[] } = { sshfs: [], unmounted: [], errors: [], steps: [] };
  const system: SharedFoldersServeSystem = {
    readMountinfo: () => options.mounted
      ? `36 25 0:43 / ${options.mounted.replace(/ /g, '\\040')} rw,nosuid,nodev - fuse.sshfs :code rw,user_id=1000\n`
      : '22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw\n',
    answers: async () => options.mountAnswers === true,
    abortConnection: (device) => {
      calls.steps.push(`abort ${device}`);
      return options.abortFails ?? null;
    },
    unmount: (path) => {
      calls.steps.push('unmount');
      calls.unmounted.push(path);
      options.onUnmount?.();
    },
    runSshfs: async (args) => {
      calls.steps.push('sshfs');
      calls.sshfs.push([...args]);
      return 0;
    },
    reportError: (message) => {
      calls.errors.push(message);
    },
  };
  return { system, calls };
}

describe('serving a computer’s folder on this server', () => {
  it('mounts the requested folder under the computer’s own folder in ~/local, over this connection', async () => {
    const home = createHome();
    const { system, calls } = createSystem();

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code/my app', homeDir: home, system });

    const mountPoint = join(home, 'local', 'laptop', 'code', 'my app');
    expect(code).toBe(0);
    expect(existsSync(mountPoint)).toBe(true);
    expect(calls.sshfs).toEqual([['-f', '-o', 'passive,idmap=user,dir_cache=yes,dcache_timeout=10', ':code/my app', mountPoint]]);
    expect(calls.errors).toEqual([]);
  });

  it('refuses anything but a folder inside the computer’s home', async () => {
    const home = createHome();
    for (const request of [undefined, '', 'ls -la', 'mount ', 'mount /etc', 'mount ../x', 'mount code/../..', 'mount ./code', 'mount -o x', 'mount code\nx']) {
      const { system, calls } = createSystem();
      const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: request, homeDir: home, system });
      expect(code, String(request)).not.toBe(0);
      expect(calls.sshfs, String(request)).toEqual([]);
      expect(calls.errors.length, String(request)).toBe(1);
    }
    expect(existsSync(join(home, 'local'))).toBe(false);
  });

  it('ends a dropped connection\'s hanging mount before touching its path, so its sshfs cannot unmount the new one later', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(join(home, 'local', 'laptop'), { recursive: true });
    // Through its path, a hanging mount gives nothing usable (mkdir there fails, a stat waits) until it is
    // unmounted, which leaves the empty folder underneath.
    writeFileSync(mountPoint, '');
    const { system, calls } = createSystem({
      mounted: mountPoint,
      mountAnswers: false,
      onUnmount: () => {
        rmSync(mountPoint);
        mkdirSync(mountPoint);
      },
    });

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code', homeDir: home, system });

    expect(code).toBe(0);
    expect(calls.unmounted).toEqual([mountPoint]);
    // Its connection is ended first: the old sshfs then leaves the path (and the new mount) alone.
    expect(calls.steps).toEqual(['abort 0:43', 'unmount', 'sshfs']);
  });

  it('ends a dead mount the requested folder lies in (a share since removed) before mounting the folder', async () => {
    const home = createHome();
    const removedShare = join(home, 'local', 'laptop', 'code');
    mkdirSync(removedShare, { recursive: true });
    const { system, calls } = createSystem({ mounted: removedShare, mountAnswers: false });

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code/app', homeDir: home, system });

    expect(code).toBe(0);
    expect(calls.unmounted).toEqual([removedShare]);
    expect(calls.steps).toEqual(['abort 0:43', 'unmount', 'sshfs']);
    expect(calls.sshfs[0]!.at(-1)).toBe(join(removedShare, 'app'));
  });

  it('mounts nothing over a hanging mount whose connection cannot be ended, and says why', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(mountPoint, { recursive: true });
    const { system, calls } = createSystem({ mounted: mountPoint, mountAnswers: false, abortFails: 'EACCES: permission denied' });

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code', homeDir: home, system });

    expect(code).not.toBe(0);
    expect(calls.steps).toEqual(['abort 0:43']);
    expect(calls.errors[0]).toMatch(/EACCES/);
  });

  it('leaves a working mount alone instead of mounting the folder twice', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(mountPoint, { recursive: true });
    const { system, calls } = createSystem({ mounted: mountPoint, mountAnswers: true });

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code', homeDir: home, system });

    expect(code).not.toBe(0);
    expect(calls.steps).toEqual([]);
    expect(calls.errors[0]).toMatch(/already mounted/);
  });

  it('never mounts over files that are already on the server', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(mountPoint, { recursive: true });
    writeFileSync(join(mountPoint, 'notes.txt'), 'server file');
    const { system, calls } = createSystem();

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code', homeDir: home, system });

    expect(code).not.toBe(0);
    expect(calls.sshfs).toEqual([]);
    expect(calls.errors[0]).toMatch(/not empty/);
  });
});
