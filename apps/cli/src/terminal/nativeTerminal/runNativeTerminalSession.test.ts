import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeServerSession } from './nativeTerminalSession.testkit';
import { runNativeTerminalSession } from './runNativeTerminalSession';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'native-terminal-'));
  dirs.push(dir);
  return dir;
}

function runWith(params: Readonly<{
  server: ReturnType<typeof fakeServerSession>;
  script: string;
  cwd: string;
  holdFailedExit?: (code: number) => Promise<void>;
}>) {
  const exit = vi.fn();
  const followed: Array<number | null> = [];
  const done = runNativeTerminalSession({
    session: params.server.session,
    cli: { command: '/bin/sh', args: ['-c', params.script, 'cli', '--session-id', 'c-1'] },
    cwd: params.cwd,
    env: { ...process.env, OUT: join(params.cwd, 'out.txt') },
    follow: ({ childPid }) => {
      followed.push(childPid);
      return async () => {
        params.server.calls.push('stop-following');
      };
    },
    process: new EventEmitter(),
    exit,
    ...(params.holdFailedExit ? { holdFailedExit: params.holdFailedExit } : {}),
    logPrefix: '[test-terminal]',
  });
  return { done, exit, followed };
}

describe('runNativeTerminalSession', () => {
  it('runs the CLI in the session folder, follows its process, and ends the session when the CLI exits', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();

    const { done, exit, followed } = runWith({
      server,
      cwd,
      script: 'printf "%s\\n" "$@" > "$OUT"; pwd >> "$OUT"; sleep 1',
    });
    await done;

    expect((await readFile(join(cwd, 'out.txt'), 'utf8')).trim().split('\n')).toEqual(['--session-id', 'c-1', cwd]);
    expect(followed).toHaveLength(1);
    expect(followed[0]).toEqual(expect.any(Number));
    expect(server.session.keepAlive).toHaveBeenCalledWith(false, 'local');
    expect(server.calls).toEqual(['stop-following', 'death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('stops the CLI when the app stops the session', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { done, exit } = runWith({
      server,
      cwd,
      script: 'trap "echo stopped > \\"$OUT\\"; exit 0" TERM; while :; do sleep 0.1; done',
    });

    await vi.waitFor(() => expect(server.handlers.has(RPC_METHODS.KILL_SESSION)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
    await done;

    expect((await readFile(join(cwd, 'out.txt'), 'utf8')).trim()).toBe('stopped');
    expect(server.calls).toEqual(['stop-following', 'death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps a failed CLI on screen until the user closes it, and never asks the daemon for a restart', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    let release: () => void = () => undefined;
    const holdFailedExit = vi.fn((_code: number) => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const { done, exit } = runWith({
      server,
      cwd,
      script: 'exit 3',
      holdFailedExit,
    });

    await vi.waitFor(() => expect(holdFailedExit).toHaveBeenCalledWith(3));
    expect(server.calls).toEqual([]);
    release();
    await done;

    expect(server.calls).toEqual(['stop-following', 'death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
