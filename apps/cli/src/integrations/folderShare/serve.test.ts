import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SharedFoldersServeSystem } from './serve';
import { agree, cleanUpServeHomes, createHome, createServeSystem, eventually, serveRequest } from './serveTestkit';

afterEach(cleanUpServeHomes);

/** A computer from before places asks for its folder alone, and gets the remounting mount under ~/local. */
const LEGACY = 'mount code';
const legacyMountPoint = (home: string) => join(home, 'local', 'laptop', 'code');

describe('serving a computer’s folder on this server', () => {
  it('ends its own connection when the mount stops answering, and only its own mount', async () => {
    const home = createHome();
    const { system, calls, mount } = createServeSystem({ mounted: { path: '/elsewhere/other', source: 'piggercode:desk:other' } });
    let watched: string | null = null;
    let stopped = false;
    let signal: AbortSignal | undefined;
    const serving: SharedFoldersServeSystem = {
      ...system,
      watchMount: (path, handlers) => {
        watched = path;
        // sshfs mounted and answered once; then the mount stops answering.
        mount({ path, source: 'piggercode:laptop:code' });
        handlers.onAnswer();
        queueMicrotask(handlers.onDead);
        return { stop: () => { stopped = true; } };
      },
      runSshfs: async (args, aborted) => {
        signal = aborted;
        await system.runSshfs(args, aborted);
        if (!aborted?.aborted) await new Promise<void>((resolve) => aborted?.addEventListener('abort', () => resolve(), { once: true }));
        return 1;
      },
    };

    const code = await serveRequest(home, LEGACY, serving);

    expect(code).toBe(1);
    expect(watched).toBe(legacyMountPoint(home));
    expect(signal?.aborted).toBe(true);
    expect(stopped).toBe(true);
    // The second mount in the table is this connection's (0:44); the other computer's (0:43) stays.
    expect(calls.steps.filter((step) => step.startsWith('abort'))).toEqual(['abort 0:44']);
    expect(calls.errors.some((message) => message.includes('did not answer for 90 s'))).toBe(true);
  });

  it('lets the watchdog see the data sshfs moves, so a connection busy with a big copy is not taken for a dead one', async () => {
    const home = createHome();
    const { system } = createServeSystem();
    const written = new Map<number, number>([[4321, 5_000]]);
    const seen: Array<number | null> = [];
    let progress: (() => number | null) | null = null;
    const serving: SharedFoldersServeSystem = {
      ...system,
      bytesWrittenBy: (pid) => written.get(pid) ?? null,
      watchMount: (_path, handlers) => {
        progress = handlers.progress;
        return { stop: () => {} };
      },
      runSshfs: async (_args, _aborted, onStarted) => {
        seen.push(progress?.() ?? null);
        onStarted?.(4321);
        seen.push(progress?.() ?? null);
        written.set(4321, 9_000);
        seen.push(progress?.() ?? null);
        return 0;
      },
    };

    await serveRequest(home, LEGACY, serving);

    // Nothing to read before sshfs runs; then what sshfs itself has written.
    expect(seen).toEqual([null, 5_000, 9_000]);
  });

  it('ends its own mount even when it never answered', async () => {
    const home = createHome();
    const { system, calls, mount } = createServeSystem();
    const serving: SharedFoldersServeSystem = {
      ...system,
      watchMount: (path, handlers) => {
        // sshfs mounted, but the mount never answers; the watchdog gives up later.
        mount({ path, source: 'piggercode:laptop:code' });
        const timer = setTimeout(handlers.onDead, 700);
        return { stop: () => clearTimeout(timer) };
      },
      runSshfs: async (args, aborted) => {
        await system.runSshfs(args, aborted);
        if (!aborted?.aborted) await new Promise<void>((resolve) => aborted?.addEventListener('abort', () => resolve(), { once: true }));
        return 1;
      },
    };

    await serveRequest(home, LEGACY, serving);

    expect(calls.steps.filter((step) => step.startsWith('abort'))).toEqual(['abort 0:43']);
  });

  it('leaves a newer connection\'s mount at the place alone when its own has gone', async () => {
    const home = createHome();
    const { system, calls, mount } = createServeSystem();
    let replaced = false;
    const serving: SharedFoldersServeSystem = {
      ...system,
      watchMount: (path, handlers) => {
        mount({ path, source: 'piggercode:laptop:code' });
        handlers.onAnswer();
        // A newer connection of the computer replaced it (its own mount is unmounted, a new one is there).
        mount({ path, source: 'piggercode:laptop:code' });
        replaced = true;
        queueMicrotask(handlers.onDead);
        return { stop: () => {} };
      },
      readMountinfo: () => {
        const table = system.readMountinfo().split('\n');
        // Once replaced, the first mount of the place (0:43) is gone; only the newer one (0:44) is listed.
        return replaced ? table.filter((line) => !line.includes(' 0:43 ')).join('\n') : table.join('\n');
      },
      runSshfs: async (args, aborted) => {
        await system.runSshfs(args, aborted);
        if (!aborted?.aborted) await new Promise<void>((resolve) => aborted?.addEventListener('abort', () => resolve(), { once: true }));
        return 1;
      },
    };

    await serveRequest(home, LEGACY, serving);

    expect(calls.steps.filter((step) => step.startsWith('abort'))).toEqual([]);
  });

  it('mounts only at a place the server agreed to for this computer', async () => {
    const home = createHome();
    agree(home, 'laptop', ['notes']);
    agree(home, 'desk', ['code']);
    const { system, calls } = createServeSystem();

    // Another computer's place, or one this computer was not agreed, is none it may mount at.
    const code = await serveRequest(home, 'mount code\tcode', system);

    expect(code).toBe(2);
    expect(calls.sshfs).toEqual([]);
    expect(calls.errors[0]).toMatch(/not a place this server agreed to/);
  });

  it('asks the server\'s record again just before mounting, so a place withdrawn meanwhile is not mounted', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    // A dead mount of its own there is ended first; meanwhile the app stopped the share.
    const { system, calls } = createServeSystem({
      mounted: { path: join(home, 'code'), source: 'piggercode:laptop:code' },
      onUnmount: () => agree(home, 'laptop', []),
    });

    expect(await serveRequest(home, 'mount code\tcode', system)).toBe(2);

    expect(calls.errors.some((message) => /no longer a place this server agreed to/.test(message))).toBe(true);
    expect(calls.sshfs).toEqual([]);
    expect(existsSync(join(home, 'code'))).toBe(false);
  });

  it('looks at the place on disk only once its own dead mount there is ended', async () => {
    const home = createHome();
    // Through a dead connection's mount the place cannot be used; ending the mount uncovers the folder.
    mkdirSync(join(home, 'local', 'laptop'), { recursive: true });
    writeFileSync(legacyMountPoint(home), '');
    const { system, calls } = createServeSystem({
      mounted: legacyMountPoint(home),
      onUnmount: () => {
        rmSync(legacyMountPoint(home));
        mkdirSync(legacyMountPoint(home));
      },
    });

    expect(await serveRequest(home, LEGACY, system)).toBe(0);
    expect(calls.sshfs).toHaveLength(1);
  });

  it('leaves a dead mount of its own alone while another computer\'s folder is mounted inside it', async () => {
    const home = createHome();
    const { system, calls } = createServeSystem({
      mounted: [
        legacyMountPoint(home),
        { path: join(legacyMountPoint(home), 'inside'), source: 'piggercode:desk:x' },
      ],
      mountAnswers: false,
    });

    const code = await serveRequest(home, LEGACY, system);

    expect(code).toBe(3);
    expect(calls.steps).toEqual([]);
  });

  it('leaves ~/local alone while a shared folder is still mounted there', async () => {
    const home = createHome();
    mkdirSync(join(home, 'local', 'laptop', 'notes'), { recursive: true });
    const { serve, fakes } = createServeSystem({ mounted: join(home, 'local', 'laptop', 'code') });

    agree(home, 'laptop', ['notes']);
    const connection = serve(home, 'mount notes\tnotes');
    await eventually(() => fakes[0]?.socket != null);
    connection.input.end();
    expect(await connection.done).toBe(0);

    expect(existsSync(join(home, 'local', 'laptop', 'notes'))).toBe(true);
  });
  it('refuses a place outside the home, a hidden one, or ~/bin', async () => {
    for (const at of ['/srv/code', '../code', '.ssh', 'work/.config', 'bin', 'local/laptop/code']) {
      const home = createHome();
      const { system, calls } = createServeSystem();

      const code = await serveRequest(home, `mount code\t${at}`, system);

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
    const { system, calls } = createServeSystem();
    agree(home, 'laptop', ['link', 'out']);

    for (const at of ['link', 'out']) {
      expect(await serveRequest(home, `mount code\t${at}`, system)).toBe(3);
    }
    // A computer from before places, under ~/local, is held to the same.
    symlinkSync(join(home, '.hidden'), join(home, 'local'));
    expect(await serveRequest(home, 'mount code', system)).toBe(3);
    expect(calls.sshfs).toEqual([]);
  });

  it('never mounts in or over a folder another computer shares here, live or not', async () => {
    const home = createHome();
    mkdirSync(join(home, 'code'), { recursive: true });
    const { system, calls } = createServeSystem({ mounted: { path: join(home, 'code'), source: 'piggercode:desk:code' }, mountAnswers: false });

    for (const at of ['code', 'code/inside']) {
      agree(home, 'laptop', [at]);
      const code = await serveRequest(home, `mount notes\t${at}`, system);
      expect(code).toBe(3);
    }
    expect(calls.steps).toEqual([]);
    expect(calls.errors.every((error) => /another computer/.test(error))).toBe(true);
  });

  it('clears the empty folders a computer moved out of under ~/local', async () => {
    const home = createHome();
    mkdirSync(join(home, 'local', 'laptop', 'code'), { recursive: true });
    const { serve, calls, fakes } = createServeSystem();

    agree(home, 'laptop', ['code']);
    const connection = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    connection.input.end();
    expect(await connection.done).toBe(0);

    expect(existsSync(join(home, 'local'))).toBe(false);
    expect(calls.sshfs[0]!.at(-1)).toBe(join(home, 'code'));
  });
  it('mounts the requested folder under the computer’s own folder in ~/local, over this connection', async () => {
    const home = createHome();
    const { system, calls } = createServeSystem();

    const code = await serveRequest(home, 'mount code/my app', system);

    const mountPoint = join(home, 'local', 'laptop', 'code', 'my app');
    expect(code).toBe(0);
    expect(existsSync(mountPoint)).toBe(true);
    expect(calls.sshfs).toEqual([['-f', '-o', 'passive,idmap=user,dir_cache=yes,dcache_timeout=10,fsname=piggercode:laptop:code%2Fmy%20app', ':code/my app', mountPoint]]);
    expect(calls.errors).toEqual([]);
  });

  it('refuses anything but a folder inside the computer’s home', async () => {
    const home = createHome();
    for (const request of [undefined, '', 'ls -la', 'mount ', 'mount /etc', 'mount ../x', 'mount code/../..', 'mount ./code', 'mount -o x', 'mount code\nx']) {
      const { system, calls } = createServeSystem();
      const code = await serveRequest(home, request, system);
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
    const { system, calls } = createServeSystem({
      mounted: mountPoint,
      mountAnswers: false,
      onUnmount: () => {
        rmSync(mountPoint);
        mkdirSync(mountPoint);
      },
    });

    const code = await serveRequest(home, 'mount code', system);

    expect(code).toBe(0);
    expect(calls.unmounted).toEqual([mountPoint]);
    // Its connection is ended first: the old sshfs then leaves the path (and the new mount) alone.
    expect(calls.steps).toEqual(['abort 0:43', 'unmount', 'sshfs']);
  });

  it('ends a dead mount the requested folder lies in (a share since removed) before mounting the folder', async () => {
    const home = createHome();
    const removedShare = join(home, 'local', 'laptop', 'code');
    mkdirSync(removedShare, { recursive: true });
    const { system, calls } = createServeSystem({ mounted: removedShare, mountAnswers: false });

    const code = await serveRequest(home, 'mount code/app', system);

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
    const { system, calls } = createServeSystem({ mounted: [removedShare, join(removedShare, 'app')], mountAnswers: false });

    const code = await serveRequest(home, 'mount code/app', system);

    expect(code).toBe(0);
    expect(calls.probed).toEqual([removedShare]);
    expect(calls.steps).toEqual(['abort 0:43', 'abort 0:44', 'unmount', 'sshfs']);
    expect(calls.unmounted).toEqual([removedShare]);
  });

  it('mounts nothing over a hanging mount whose connection cannot be ended, and says why', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(mountPoint, { recursive: true });
    const { system, calls } = createServeSystem({ mounted: mountPoint, mountAnswers: false, abortFails: 'EACCES: permission denied' });

    const code = await serveRequest(home, 'mount code', system);

    expect(code).not.toBe(0);
    expect(calls.steps).toEqual(['abort 0:43']);
    expect(calls.errors[0]).toMatch(/EACCES/);
  });

  it('leaves a working mount alone instead of mounting the folder twice', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(mountPoint, { recursive: true });
    const { system, calls } = createServeSystem({ mounted: mountPoint, mountAnswers: true });

    const code = await serveRequest(home, 'mount code', system);

    expect(code).not.toBe(0);
    expect(calls.steps).toEqual([]);
    expect(calls.errors[0]).toMatch(/already mounted/);
  });

  it('never mounts over files that are already on the server', async () => {
    const home = createHome();
    const mountPoint = join(home, 'local', 'laptop', 'code');
    mkdirSync(mountPoint, { recursive: true });
    writeFileSync(join(mountPoint, 'notes.txt'), 'server file');
    const { system, calls } = createServeSystem();

    const code = await serveRequest(home, 'mount code', system);

    expect(code).not.toBe(0);
    expect(calls.sshfs).toEqual([]);
    expect(calls.errors[0]).toMatch(/not empty/);
  });
});
