import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
/** A mount in the table: a path (mounted by a computer from before locations), or one that names its owner. */
// A throwaway public key (its private half was never kept).
const COMPUTER_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';

/** The server's record that it agrees to `places` for the computer `label`: its line in authorized_keys. */
function agree(home: string, label: string, places: readonly string[]): void {
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  const file = join(home, '.ssh', 'authorized_keys');
  const comment = `piggercode-shared-folders:machine-${label}`;
  const others = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line && !line.endsWith(comment)) : [];
  const command = `/srv/piggercode machine shared-folders serve --label ${label}${places.map((place) => ` --place '${place}'`).join('')}`;
  writeFileSync(file, [...others, `restrict,command="${command}" ${COMPUTER_KEY} ${comment}`, ''].join('\n'), { mode: 0o600 });
}

type MountedEntry = string | Readonly<{ path: string; source: string }>;

function createSystem(options: Readonly<{ mounted?: MountedEntry | readonly MountedEntry[]; mountAnswers?: boolean; abortFails?: string; onUnmount?: () => void; onSshfs?: () => void }> = {}) {
  const calls: { sshfs: string[][]; unmounted: string[]; errors: string[]; steps: string[]; probed: string[] } = { sshfs: [], unmounted: [], errors: [], steps: [], probed: [] };
  const listed = options.mounted === undefined ? [] : Array.isArray(options.mounted) ? options.mounted : [options.mounted as MountedEntry];
  const mounted = listed.map((entry) => (typeof entry === 'string' ? { path: entry, source: ':code' } : entry));
  const system: SharedFoldersServeSystem = {
    readMountinfo: () => [
      '22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw',
      ...mounted.map((mount, index) => `${36 + index} 25 0:${43 + index} / ${mount.path.replace(/ /g, '\\040')} rw,nosuid,nodev - fuse.sshfs ${mount.source} rw,user_id=1000`),
      '',
    ].join('\n'),
    answers: async (path) => {
      calls.probed.push(path);
      return options.mountAnswers === true;
    },
    abortConnection: (device) => {
      calls.steps.push(`abort ${device}`);
      return options.abortFails ?? null;
    },
    unmount: (path) => {
      calls.steps.push('unmount');
      calls.unmounted.push(path);
      // Unmounting detaches it and everything mounted under it.
      for (let index = mounted.length - 1; index >= 0; index -= 1) {
        const entry = mounted[index]!;
        if (entry.path === path || entry.path.startsWith(`${path}/`)) mounted.splice(index, 1);
      }
      options.onUnmount?.();
    },
    runSshfs: async (args) => {
      calls.steps.push('sshfs');
      calls.sshfs.push([...args]);
      options.onSshfs?.();
      return 0;
    },
    reportError: (message) => {
      calls.errors.push(message);
    },
  };
  /** Another mount appears, as the mount table will list it from now on. */
  const mount = (entry: Readonly<{ path: string; source: string }>) => {
    mounted.push(entry);
  };
  return { system, calls, mount };
}

describe('serving a computer’s folder on this server', () => {
  it('mounts the folder where the computer asks, in this home, naming the mount as that computer\'s', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { system, calls } = createSystem();

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system });

    expect(code).toBe(0);
    expect(calls.sshfs).toEqual([['-f', '-o', 'passive,idmap=user,dir_cache=yes,dcache_timeout=10,fsname=piggercode:laptop:code', ':code', join(home, 'code')]]);
  });

  it('mounts only at a place the server agreed to for this computer', async () => {
    const home = createHome();
    agree(home, 'laptop', ['notes']);
    agree(home, 'desk', ['code']);
    const { system, calls } = createSystem();

    // Another computer's place, or one this computer was not agreed, is none it may mount at.
    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system });

    expect(code).toBe(2);
    expect(calls.sshfs).toEqual([]);
    expect(calls.errors[0]).toMatch(/not a place this server agreed to/);
  });

  it('asks the server\'s record again just before mounting, so a place withdrawn meanwhile is not mounted', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    // A dead mount of its own there is ended first; meanwhile the app stopped the share.
    const { system, calls } = createSystem({
      mounted: { path: join(home, 'code'), source: 'piggercode:laptop:code' },
      onUnmount: () => agree(home, 'laptop', []),
    });

    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system })).toBe(2);

    expect(calls.errors[0]).toMatch(/no longer a place this server agreed to/);
    expect(calls.sshfs).toEqual([]);
    expect(existsSync(join(home, 'code'))).toBe(false);
  });

  it('looks at the place on disk only once its own dead mount there is ended', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    // Through a dead connection's mount the place cannot be used; ending the mount uncovers the folder.
    writeFileSync(join(home, 'code'), '');
    const { system, calls } = createSystem({
      mounted: { path: join(home, 'code'), source: 'piggercode:laptop:code' },
      onUnmount: () => {
        rmSync(join(home, 'code'));
        mkdirSync(join(home, 'code'));
      },
    });

    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system })).toBe(0);
    expect(calls.sshfs).toHaveLength(1);
  });

  it('clears its place once the share moved away and the mount ended, with the folders made for it', async () => {
    const home = createHome();
    mkdirSync(join(home, 'work'));
    agree(home, 'laptop', ['work/projects/app']);
    // The app moves the share while it is mounted: the server agrees to the new place first.
    const { system } = createSystem({ onSshfs: () => agree(home, 'laptop', ['notes']) });

    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount app\twork/projects/app', homeDir: home, system })).toBe(0);

    expect(existsSync(join(home, 'work', 'projects'))).toBe(false);
    expect(existsSync(join(home, 'work'))).toBe(true);
  });

  it('never clears its place through a folder another computer has mounted there since', async () => {
    const home = createHome();
    agree(home, 'laptop', ['projects/app']);
    // The share moved away while its mount ended late; meanwhile another computer mounted ~/projects.
    const served = createSystem({
      onSshfs: () => {
        agree(home, 'laptop', ['notes']);
        served.mount({ path: join(home, 'projects'), source: 'piggercode:desk:projects' });
      },
    });

    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount app\tprojects/app', homeDir: home, system: served.system })).toBe(0);

    expect(existsSync(join(home, 'projects', 'app'))).toBe(true);
  });

  it('keeps its place for the next connection when the connection only dropped', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { system } = createSystem();

    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system })).toBe(0);

    expect(existsSync(join(home, 'code'))).toBe(true);
  });

  it('leaves a dead mount of its own alone while another computer\'s folder is mounted inside it', async () => {
    const home = createHome();
    const { system, calls } = createSystem({
      mounted: [
        { path: join(home, 'code'), source: 'piggercode:laptop:code' },
        { path: join(home, 'code', 'inside'), source: 'piggercode:desk:x' },
      ],
      mountAnswers: false,
    });

    agree(home, 'laptop', ['code']);
    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system });

    expect(code).toBe(3);
    expect(calls.steps).toEqual([]);
  });

  it('leaves ~/local alone while a shared folder is still mounted there', async () => {
    const home = createHome();
    mkdirSync(join(home, 'local', 'laptop', 'notes'), { recursive: true });
    const { system } = createSystem({ mounted: join(home, 'local', 'laptop', 'code') });

    agree(home, 'laptop', ['notes']);
    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount notes\tnotes', homeDir: home, system })).toBe(0);

    expect(existsSync(join(home, 'local', 'laptop', 'notes'))).toBe(true);
  });

  it('refuses a place outside the home, a hidden one, or ~/bin', async () => {
    for (const at of ['/srv/code', '../code', '.ssh', 'work/.config', 'bin', 'local/laptop/code']) {
      const home = createHome();
      const { system, calls } = createSystem();

      const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: `mount code\t${at}`, homeDir: home, system });

      expect(code).toBe(2);
      expect(calls.sshfs).toEqual([]);
      expect(calls.errors).toHaveLength(1);
    }
  });

  it('refuses a place a symbolic link turns into a hidden folder or one outside the home', async () => {
    const home = createHome();
    mkdirSync(join(home, '.hidden'));
    symlinkSync(join(home, '.hidden'), join(home, 'link'));
    symlinkSync(tmpdir(), join(home, 'out'));
    const { system, calls } = createSystem();
    agree(home, 'laptop', ['link', 'out']);

    for (const at of ['link', 'out']) {
      expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: `mount code\t${at}`, homeDir: home, system })).toBe(3);
    }
    // A computer from before places, under ~/local, is held to the same.
    symlinkSync(join(home, '.hidden'), join(home, 'local'));
    expect(await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code', homeDir: home, system })).toBe(3);
    expect(calls.sshfs).toEqual([]);
  });

  it('never mounts in or over a folder another computer shares here, live or not', async () => {
    const home = createHome();
    mkdirSync(join(home, 'code'), { recursive: true });
    const { system, calls } = createSystem({ mounted: { path: join(home, 'code'), source: 'piggercode:desk:code' }, mountAnswers: false });

    for (const at of ['code', 'code/inside']) {
      agree(home, 'laptop', [at]);
      const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: `mount notes\t${at}`, homeDir: home, system });
      expect(code).toBe(3);
    }
    expect(calls.steps).toEqual([]);
    expect(calls.errors.every((error) => /another computer/.test(error))).toBe(true);
  });

  it('clears the empty folders a computer moved out of under ~/local', async () => {
    const home = createHome();
    mkdirSync(join(home, 'local', 'laptop', 'code'), { recursive: true });
    const { system, calls } = createSystem();

    agree(home, 'laptop', ['code']);
    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code\tcode', homeDir: home, system });

    expect(code).toBe(0);
    expect(existsSync(join(home, 'local'))).toBe(false);
    expect(calls.sshfs[0]!.at(-1)).toBe(join(home, 'code'));
  });

  it('mounts the requested folder under the computer’s own folder in ~/local, over this connection', async () => {
    const home = createHome();
    const { system, calls } = createSystem();

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code/my app', homeDir: home, system });

    const mountPoint = join(home, 'local', 'laptop', 'code', 'my app');
    expect(code).toBe(0);
    expect(existsSync(mountPoint)).toBe(true);
    expect(calls.sshfs).toEqual([['-f', '-o', 'passive,idmap=user,dir_cache=yes,dcache_timeout=10,fsname=piggercode:laptop:code%2Fmy%20app', ':code/my app', mountPoint]]);
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

  it('ends every connection a dead outer mount takes with it, and asks only the outer one', async () => {
    const home = createHome();
    const removedShare = join(home, 'local', 'laptop', 'code');
    mkdirSync(join(removedShare, 'app'), { recursive: true });
    // `code` (a share since removed) died with `code/app` mounted inside it; unmounting `code` detaches both.
    const { system, calls } = createSystem({ mounted: [removedShare, join(removedShare, 'app')], mountAnswers: false });

    const code = await runSharedFoldersServe({ label: 'laptop', originalCommand: 'mount code/app', homeDir: home, system });

    expect(code).toBe(0);
    expect(calls.probed).toEqual([removedShare]);
    expect(calls.steps).toEqual(['abort 0:43', 'abort 0:44', 'unmount', 'sshfs']);
    expect(calls.unmounted).toEqual([removedShare]);
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
