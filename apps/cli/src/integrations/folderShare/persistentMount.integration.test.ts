import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { persistentMountDir } from './persistentMount';
import { runSharedFoldersServe } from './serve';
import { osServeSystem } from './serveSystem';
import { listSharedFolderMounts, readMountinfo } from './sharedFolderMounts';
import { agree } from './serveTestkit';

/**
 * A placed shared folder across a dropped connection, with the real sshfs (`-o reconnect`), FUSE and an
 * OpenSSH sftp-server standing in for the computer: a shell working in the folder keeps its folder, and its
 * relative paths work again once the computer connects again, on the same mount. `socat` stands in for
 * `piggercode … attach`, as in `shellRoundTrip.integration.test.ts`. Runs only where all of these exist.
 */

const SFTP_SERVER = ['/usr/lib/openssh/sftp-server', '/usr/libexec/openssh/sftp-server', '/usr/libexec/sftp-server']
  .find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
const found = (command: string) => spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
const hasFuse = (() => {
  try {
    accessSync('/dev/fuse', constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
})();
const hasTools = process.platform === 'linux' && hasFuse && SFTP_SERVER !== undefined
  && found('sshfs') && found('socat') && (found('fusermount3') || found('fusermount'));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** One connection of the computer: its sftp-server in the computer's home, joined to a `serve`. */
function connectComputer(home: string, computerHome: string): Readonly<{ computer: ChildProcess; served: Promise<number> }> {
  const computer = spawn(SFTP_SERVER!, ['-d', computerHome], { stdio: ['pipe', 'pipe', 'ignore'] });
  const served = runSharedFoldersServe({
    label: 'laptop',
    originalCommand: 'mount code\tcode',
    homeDir: home,
    happyHomeDir: join(home, '.p'),
    input: computer.stdout!,
    output: computer.stdin!,
    attachCommand: (dir) => `socat STDIO UNIX-CONNECT:${join(dir, 'sock')}`,
  });
  return { computer, served };
}

/** A shell working in `dir`: each line asks for its folder (getcwd) and reads `file.txt` by its relative path. */
function startShell(dir: string): Readonly<{ ask: () => Promise<string> }> {
  // Started outside the mount and moved into it by itself: this test process carries the mount's connection,
  // so it must never wait on the mount itself (a spawn with its cwd there waits for the child's chdir).
  const shell = spawn('sh', ['-c', 'cd "$1" || exit 1; while read _; do pwd -P 2>&1; cat file.txt 2>&1; echo "--"; done', 'sh', dir], { cwd: '/', stdio: ['pipe', 'pipe', 'ignore'] });
  cleanups.push(() => shell.kill('SIGKILL'));
  let buffered = '';
  shell.stdout!.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
  });
  return {
    ask: async () => {
      buffered = '';
      shell.stdin!.write('\n');
      const deadline = Date.now() + 15_000;
      while (!buffered.includes('--\n')) {
        if (Date.now() > deadline) throw new Error('the shell did not answer');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return buffered.replace(/--\n$/, '').trim();
    },
  };
}

async function waitFor<T>(read: () => T | undefined, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!hasTools)('a placed shared folder across a dropped connection (real sshfs)', () => {
  it('keeps the mount, and the folder of a shell working in it, and serves it again through the next connection', async () => {
    const cwd = process.cwd();
    // Short, so the socket path stays well within sun_path for socat.
    const home = mkdtempSync('/tmp/pcm-');
    const computerHome = join(home, 'mac');
    mkdirSync(join(computerHome, 'code', 'sub'), { recursive: true });
    writeFileSync(join(computerHome, 'code', 'sub', 'file.txt'), 'hello from the computer');
    agree(home, 'laptop', ['code']);
    const mountPoint = join(home, 'code');
    const dir = persistentMountDir(join(home, '.p'), mountPoint);
    cleanups.push(() => {
      process.chdir(cwd);
      try {
        const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as { sshfs: { pid: number } };
        process.kill(state.sshfs.pid, 'SIGKILL');
      } catch {
        // Not started, or gone.
      }
      spawnSync('fusermount3', ['-uz', mountPoint], { stdio: 'ignore' });
      spawnSync('fusermount', ['-uz', mountPoint], { stdio: 'ignore' });
      rmSync(home, { recursive: true, force: true });
    });
    const mounted = () => listSharedFolderMounts(home, readMountinfo()).find((mount) => mount.path === mountPoint);

    const first = connectComputer(home, computerHome);
    cleanups.push(() => first.computer.kill('SIGKILL'));
    const device = (await waitFor(mounted)).device;
    const shell = startShell(join(mountPoint, 'sub'));
    expect(await shell.ask()).toBe(`${join(mountPoint, 'sub')}\nhello from the computer`);

    // The computer goes away: its connection ends; the mount stays, and fails at once instead of hanging.
    first.computer.kill('SIGKILL');
    expect(await first.served).toBe(0);
    expect(mounted()?.device).toBe(device);
    const away = await shell.ask();
    expect(away.split('\n')[0]).toBe(join(mountPoint, 'sub'));
    expect(away).toMatch(/Input\/output error/);

    // It connects again: the same mount, the same shell, its relative path works again.
    writeFileSync(join(computerHome, 'code', 'sub', 'file.txt'), 'hello again');
    const second = connectComputer(home, computerHome);
    cleanups.push(() => second.computer.kill('SIGKILL'));
    const deadline = Date.now() + 15_000;
    let again = await shell.ask();
    while (!again.endsWith('hello again') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      again = await shell.ask();
    }
    expect(again).toBe(`${join(mountPoint, 'sub')}\nhello again`);
    expect(mounted()?.device).toBe(device);

    second.computer.kill('SIGKILL');
    expect(await second.served).toBe(0);
  }, 60_000);
});
