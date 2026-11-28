import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { withJsonOwnerFileLock } from '@/utils/fs/jsonOwnerFileLock';

import { clearWithdrawnPersistentMounts, mountLockPath, persistentMountDir, runPersistentMountAttach } from './persistentMount';
import { agree, cleanUpServeHomes, createHome, createServeSystem, eventually } from './serveTestkit';

afterEach(cleanUpServeHomes);

const dirOf = (home: string, at: string) => persistentMountDir(join(home, '.piggercode'), join(home, at));

describe('a placed shared folder keeps one mount across its connections', () => {
  it('mounts it with one sshfs that reconnects through the computer’s connections, and carries this one both ways', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();

    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    first.input.write('from the computer');
    fakes[0]!.socket!.write('from sshfs');
    await eventually(() => fakes[0]!.received === 'from the computer' && first.received() === 'from sshfs');

    const dir = dirOf(home, 'code');
    expect(calls.sshfs).toEqual([[
      '-f',
      '-o',
      `reconnect,idmap=user,dir_cache=yes,dcache_timeout=10,ssh_command=/bin/sh ${join(dir, 'attach.sh')},fsname=piggercode:laptop:code`,
      'x:code',
      join(home, 'code'),
    ]]);
    // The script fails at once while no connection is offered, and otherwise joins it.
    expect(readFileSync(join(dir, 'attach.sh'), 'utf8')).toContain(`[ -S '${join(dir, 'sock')}' ] || exit 1\nexec attach --dir '${dir}'\n`);

    // The connection drops: the mount stays, with its sshfs and its folder.
    first.input.end();
    expect(await first.done).toBe(0);
    expect(calls.unmounted).toEqual([]);
    expect(calls.killed).toEqual([]);
    expect(calls.steps.filter((step) => step.startsWith('abort'))).toEqual([]);
    expect(fakes[0]!.alive).toBe(true);
    expect(existsSync(join(home, 'code'))).toBe(true);
  });

  it('serves the same mount through the next connection after a drop: no second sshfs, nothing ended', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    first.input.end();
    await first.done;
    await eventually(() => fakes[0]!.socket === null);

    const second = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]!.socket != null);
    second.input.write('again');
    await eventually(() => fakes[0]!.received.endsWith('again'));

    expect(calls.sshfs).toHaveLength(1);
    expect(calls.unmounted).toEqual([]);
    expect(calls.killed).toEqual([]);
    expect(calls.errors).toEqual([]);
    second.input.end();
    expect(await second.done).toBe(0);
  });

  it('refuses a second connection while the mount answers through the first, as before, and touches nothing', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);

    const second = serve(home, 'mount code\tcode');

    expect(await second.done).toBe(3);
    expect(calls.errors.some((message) => /already mounted/.test(message))).toBe(true);
    expect(calls.killed).toEqual([]);
    expect(calls.unmounted).toEqual([]);
    expect(fakes[0]!.socket).not.toBeNull();
    first.input.end();
    await first.done;
  });

  it('keeps a connection that is slow to answer while data still comes from the computer', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const harness = createServeSystem();
    const first = harness.serve(home, 'mount code\tcode');
    await eventually(() => harness.fakes[0]?.socket != null);
    // A big copy holds the probe, but the computer keeps sending.
    harness.fakes[0]!.stalled = true;
    const probe = harness.system.probe;
    (harness.system as { probe: typeof probe }).probe = async (path) => {
      first.input.write('more of the copy');
      await new Promise((resolve) => setTimeout(resolve, 50));
      return await probe(path);
    };

    const second = harness.serve(home, 'mount code\tcode');

    expect(await second.done).toBe(3);
    expect(harness.calls.killed).toEqual([]);
    first.input.end();
    await first.done;
  });

  it('ends a stalled connection by ending the serve that carries it, then serves the mount through the new one', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    // The computer went away without a word (a new network): its old connection hangs.
    fakes[0]!.stalled = true;

    const second = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]!.socket != null && calls.killed.length > 0);

    expect(calls.killed).toEqual([[first.identity.pid, 'SIGTERM']]);
    expect(calls.unmounted).toEqual([]);
    expect(calls.sshfs).toHaveLength(1);
    second.input.write('through the new one');
    await eventually(() => fakes[0]!.received.endsWith('through the new one'));
    second.input.end();
    expect(await second.done).toBe(0);
    await first.done;
  });

  it('replaces the mount when sshfs itself does not answer once the stalled connection is gone', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    fakes[0]!.wedged = true;

    const second = serve(home, 'mount code\tcode');
    await eventually(() => fakes[1]?.socket != null);

    expect(calls.killed).toEqual([[first.identity.pid, 'SIGTERM'], [fakes[0]!.pid, 'SIGKILL']]);
    expect(calls.steps.filter((step) => step !== 'sshfs')).toEqual(['abort 0:43', 'unmount']);
    expect(calls.sshfs).toHaveLength(2);
    expect(calls.errors.some((message) => /lost their folder/.test(message))).toBe(true);
    second.input.end();
    await second.done;
    await first.done;
  });

  it('replaces a mount whose sshfs is gone, whatever folder it served', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, system, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    first.input.end();
    await first.done;
    // Killed while the computer was away (out of memory): its mount is still listed, and dead.
    system.kill(fakes[0]!.pid, 'SIGKILL');

    const second = serve(home, 'mount code\tcode');
    await eventually(() => fakes[1]?.socket != null);

    expect(calls.steps.filter((step) => step !== 'sshfs')).toEqual(['abort 0:43', 'unmount']);
    expect(calls.sshfs).toHaveLength(2);
    second.input.end();
    await second.done;
    await eventually(() => fakes[1]!.socket === null);

    // The replacement is the mount now: the next connection is served by it.
    const third = serve(home, 'mount code\tcode');
    await eventually(() => fakes[1]!.socket != null);
    expect(calls.sshfs).toHaveLength(2);
    third.input.end();
    await third.done;
  });

  it('replaces a disconnected mount that serves another folder, but refuses while that one is still connected', async () => {
    const home = createHome();
    agree(home, 'laptop', ['work']);
    const { serve, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount old\twork');
    await eventually(() => fakes[0]?.socket != null);

    // A late request for another folder at the same place does not evict the live mount.
    const late = serve(home, 'mount new\twork');
    expect(await late.done).toBe(3);
    expect(calls.unmounted).toEqual([]);

    first.input.end();
    await first.done;
    await eventually(() => fakes[0]!.socket === null);
    const moved = serve(home, 'mount new\twork');
    await eventually(() => fakes[1]?.socket != null);

    expect(calls.unmounted).toEqual([join(home, 'work')]);
    expect(calls.sshfs[1]).toContain('x:new');
    moved.input.end();
    await moved.done;
  });

  it('keeps a remounting mount from before while it answers, and replaces it once it does not', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    mkdirSync(join(home, 'code'));
    const working = createServeSystem({ mounted: { path: join(home, 'code'), source: 'piggercode:laptop:code' }, mountAnswers: true });

    expect(await working.serve(home, 'mount code\tcode').done).toBe(3);
    expect(working.calls.steps).toEqual([]);

    const dead = createServeSystem({ mounted: { path: join(home, 'code'), source: 'piggercode:laptop:code' }, mountAnswers: false });
    const replacing = dead.serve(home, 'mount code\tcode');
    await eventually(() => dead.fakes[0]?.socket != null);
    expect(dead.calls.steps).toEqual(['abort 0:43', 'unmount', 'sshfs']);
    replacing.input.end();
    await replacing.done;
  });

  it('leaves a mount alone while another computer’s folder is mounted inside it', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls } = createServeSystem({
      mounted: [
        { path: join(home, 'code'), source: 'piggercode:laptop:code' },
        { path: join(home, 'code', 'inside'), source: 'piggercode:desk:x' },
      ],
    });

    expect(await serve(home, 'mount code\tcode').done).toBe(3);
    expect(calls.steps).toEqual([]);
    expect(calls.errors.some((message) => /another computer shares/.test(message))).toBe(true);
  });

  it('ends the mount, and the folders made for it, once its connection ends after the share moved away', async () => {
    const home = createHome();
    mkdirSync(join(home, 'work'));
    agree(home, 'laptop', ['work/projects/app']);
    const { serve, calls, fakes } = createServeSystem();
    const connection = serve(home, 'mount app\twork/projects/app');
    // Carried (the first mount is done) before the agreement changes.
    await eventually(() => fakes[0]?.socket != null && calls.watches.length === 1);

    // The app moves the share: the server agrees to the new place first, then the connection ends.
    agree(home, 'laptop', ['notes']);
    connection.input.end();
    await connection.done;

    expect(calls.unmounted).toEqual([join(home, 'work', 'projects', 'app')]);
    expect(calls.killed).toEqual([[fakes[0]!.pid, 'SIGKILL']]);
    expect(existsSync(join(home, 'work', 'projects'))).toBe(false);
    expect(existsSync(join(home, 'work'))).toBe(true);
  });

  it('never removes folders through a folder another computer has mounted on the way since', async () => {
    const home = createHome();
    agree(home, 'laptop', ['projects/app']);
    const harness = createServeSystem();
    const connection = harness.serve(home, 'mount app\tprojects/app');
    // Carried (the first mount is done) before the agreement changes.
    await eventually(() => harness.fakes[0]?.socket != null && harness.calls.watches.length === 1);

    agree(home, 'laptop', ['notes']);
    harness.mount({ path: join(home, 'projects'), source: 'piggercode:desk:projects' });
    connection.input.end();
    await connection.done;

    expect(existsSync(join(home, 'projects', 'app'))).toBe(true);
  });

  it('lets the daemon end the mounts of places withdrawn, leave the agreed ones, and report the busy ones', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code', 'notes']);
    const harness = createServeSystem();
    for (const at of ['code', 'notes']) {
      const connection = harness.serve(home, `mount ${at}\t${at}`);
      await eventually(() => harness.fakes.some((fake) => fake.mountPoint === join(home, at) && fake.socket != null));
      connection.input.end();
      await connection.done;
    }
    agree(home, 'laptop', ['notes']);

    const first = await clearWithdrawnPersistentMounts({ homeDir: home, happyHomeDir: join(home, '.piggercode'), system: harness.system });

    expect(first).toEqual({ ended: [join(home, 'code')], busy: [], failed: [] });
    expect(harness.calls.unmounted).toEqual([join(home, 'code')]);
    expect(harness.fakes.find((fake) => fake.mountPoint === join(home, 'notes'))!.alive).toBe(true);

    // A place withdrawn while its mount's lock is held is left for the next pass.
    agree(home, 'laptop', []);
    const notesDir = dirOf(home, 'notes');
    let release: () => void = () => undefined;
    const held = withJsonOwnerFileLock({ lockPath: mountLockPath(notesDir), timeoutMs: 1_000, staleAfterMs: 60_000, errorCode: 'busy' }, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await eventually(() => existsSync(mountLockPath(notesDir)));
    const second = await clearWithdrawnPersistentMounts({ homeDir: home, happyHomeDir: join(home, '.piggercode'), system: harness.system, lockWaitMs: 50 });
    expect(second).toEqual({ ended: [], busy: [notesDir], failed: [] });
    release();
    await held;
    const third = await clearWithdrawnPersistentMounts({ homeDir: home, happyHomeDir: join(home, '.piggercode'), system: harness.system });
    expect(third.ended).toEqual([join(home, 'notes')]);
  });

  it('never ends a mount on a record it cannot read', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const harness = createServeSystem();
    const connection = harness.serve(home, 'mount code\tcode');
    await eventually(() => harness.fakes[0]?.socket != null);
    connection.input.end();
    await connection.done;
    // The record cannot be read now (a folder where the file belongs; root reads any file).
    rmSync(join(home, '.ssh', 'authorized_keys'));
    mkdirSync(join(home, '.ssh', 'authorized_keys'));

    const result = await clearWithdrawnPersistentMounts({ homeDir: home, happyHomeDir: join(home, '.piggercode'), system: harness.system });

    // Nothing ended, and the mount is left for the next pass, once the record can be read again.
    expect(result).toEqual({ ended: [], busy: [dirOf(home, 'code')], failed: [] });
    expect(harness.calls.unmounted).toEqual([]);
    expect(harness.fakes[0]!.alive).toBe(true);
  });

  it('undoes a first mount that sshfs could not make, and says why', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem({ sshfsMounts: false });

    expect(await serve(home, 'mount code\tcode').done).toBe(3);

    expect(calls.errors.at(-1)).toMatch(/sshfs did not mount ~\/code: read: Connection reset by peer/);
    expect(fakes[0]!.alive).toBe(false);
    expect(existsSync(join(dirOf(home, 'code'), 'state.json'))).toBe(false);
    expect(existsSync(join(dirOf(home, 'code'), 'owner.json'))).toBe(false);
    // The folder this attempt made goes too: a stop before the next try would find no record of it.
    expect(existsSync(join(home, 'code'))).toBe(false);
  });

  it('ends its own stalled connection on the watchdog, and the mount too when sshfs does not answer either', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const connection = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null && calls.watches.length === 1);
    fakes[0]!.wedged = true;

    calls.watches[0]!.handlers.onDead();

    expect(await connection.done).toBe(3);
    expect(calls.errors.some((message) => /did not answer for 90 s/.test(message))).toBe(true);
    expect(calls.unmounted).toEqual([join(home, 'code')]);
    expect(calls.killed).toEqual([[fakes[0]!.pid, 'SIGKILL']]);
  });

  it('ends a stuck serve that ignores SIGTERM with SIGKILL, then takes over', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const first = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null);
    fakes[0]!.stalled = true;
    first.ignoreTerm.value = true;

    const second = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]!.socket != null && calls.killed.length === 2);

    expect(calls.killed).toEqual([[first.identity.pid, 'SIGTERM'], [first.identity.pid, 'SIGKILL']]);
    expect(calls.unmounted).toEqual([]);
    second.input.end();
    await second.done;
    await first.done;
  });

  it('ends only its stalled connection on the watchdog while sshfs itself answers', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const connection = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null && calls.watches.length === 1);
    fakes[0]!.stalled = true;

    calls.watches[0]!.handlers.onDead();

    expect(await connection.done).toBe(3);
    expect(calls.unmounted).toEqual([]);
    expect(calls.killed).toEqual([]);
    expect(fakes[0]!.alive).toBe(true);
  });

  it('keeps a connection the watchdog gave up on when data came while it waited for the lock', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls, fakes } = createServeSystem();
    const connection = serve(home, 'mount code\tcode');
    await eventually(() => fakes[0]?.socket != null && calls.watches.length === 1);
    // Another connection holds the lock (it is asking the mount) when the watchdog fires.
    let release: () => void = () => undefined;
    const held = withJsonOwnerFileLock({ lockPath: mountLockPath(dirOf(home, 'code')), timeoutMs: 1_000, staleAfterMs: 60_000, errorCode: 'busy' }, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await eventually(() => existsSync(mountLockPath(dirOf(home, 'code'))));

    calls.watches[0]!.handlers.onDead();
    connection.input.write('the copy goes on');
    await eventually(() => fakes[0]!.received.endsWith('the copy goes on'));
    release();
    await held;

    await eventually(() => calls.watches.length === 2);
    expect(fakes[0]!.socket).not.toBeNull();
    connection.input.end();
    expect(await connection.done).toBe(0);
  });

  it('ends a first mount at once when its place was withdrawn while it mounted', async () => {
    const home = createHome();
    agree(home, 'laptop', ['code']);
    const { serve, calls } = createServeSystem({ onSshfs: () => agree(home, 'laptop', []) });

    expect(await serve(home, 'mount code\tcode').done).toBe(2);

    expect(calls.unmounted).toEqual([join(home, 'code')]);
    expect(existsSync(join(home, 'code'))).toBe(false);
  });

  it('ends the mount of a share moved inward before mounting the new place, under that mount\'s lock', async () => {
    const home = createHome();
    agree(home, 'laptop', ['work']);
    const { serve, calls, fakes } = createServeSystem();
    const old = serve(home, 'mount work\twork');
    await eventually(() => fakes[0]?.socket != null);
    old.input.end();
    await old.done;
    agree(home, 'laptop', ['work/app']);

    const moved = serve(home, 'mount work\twork/app');
    await eventually(() => fakes[1]?.socket != null);

    expect(calls.unmounted).toEqual([join(home, 'work')]);
    expect(calls.killed).toEqual([[fakes[0]!.pid, 'SIGKILL']]);
    expect(fakes[1]!.mountPoint).toBe(join(home, 'work', 'app'));
    moved.input.end();
    await moved.done;
  });

  it('keeps the remounting sshfs for a home that sshfs cannot name in its command', async () => {
    const home = mkdtempSync(join(tmpdir(), 'piggercode serve '));
    try {
      agree(home, 'laptop', ['code']);
      const { serve, calls } = createServeSystem();

      expect(await serve(home, 'mount code\tcode').done).toBe(0);

      expect(calls.sshfs[0]?.[2]).toMatch(/^passive,/);
    } finally {
      cleanUpServeHomes();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('attach, the script sshfs runs to reach the computer', () => {
  it('joins the connection offered on the mount’s socket, and carries it both ways', async () => {
    const dir = createHome();
    const received: string[] = [];
    const server = createServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk.toString('utf8')));
      socket.write('to sshfs');
      socket.end();
    });
    process.chdir(dir);
    await new Promise<void>((resolve) => server.listen('s-1.sock', resolve));
    symlinkSync('s-1.sock', join(dir, 'sock'));
    const input = new PassThrough();
    const output = new PassThrough();
    let out = '';
    output.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });

    const attached = runPersistentMountAttach({ dir, input, output });
    input.write('to the computer');

    expect(await attached).toBe(0);
    expect(out).toBe('to sshfs');
    expect(received.join('')).toBe('to the computer');
    server.close();
  });

  it('ends as soon as sshfs closes its side, even while the other side stays open', async () => {
    const dir = createHome();
    const server = createServer(() => undefined);
    process.chdir(dir);
    await new Promise<void>((resolve) => server.listen('s-3.sock', resolve));
    symlinkSync('s-3.sock', join(dir, 'sock'));
    const input = new PassThrough();

    const attached = runPersistentMountAttach({ dir, input, output: new PassThrough() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    input.end();

    expect(await attached).toBe(0);
    server.close();
  });

  it('fails at once with no connection offered, and removes a socket nobody listens on any more', async () => {
    const dir = createHome();
    expect(await runPersistentMountAttach({ dir, input: new PassThrough(), output: new PassThrough() })).toBe(1);

    // A serve that was killed leaves its socket file behind, with nobody listening on it.
    const listener = spawn(process.execPath, ['-e', "require('net').createServer().listen('s-2.sock', () => process.kill(process.pid, 'SIGKILL'))"], { cwd: dir, stdio: 'ignore' });
    await new Promise((resolve) => listener.once('exit', resolve));
    expect(existsSync(join(dir, 's-2.sock'))).toBe(true);
    symlinkSync('s-2.sock', join(dir, 'sock'));

    expect(await runPersistentMountAttach({ dir, input: new PassThrough(), output: new PassThrough() })).toBe(1);
    expect(existsSync(join(dir, 's-2.sock'))).toBe(false);
    expect(readlinkSync(join(dir, 'sock'))).toBe('s-2.sock');
  });
});
