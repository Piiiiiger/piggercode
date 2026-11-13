import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { accountSettingsParse } from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeTerminalActivity } from './nativeTerminalActivityReporter';
import { fakePushService, fakeServerSession } from './nativeTerminalSession.testkit';
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
  /** The account's settings (an account that never changed any by default; null: not known yet). */
  settings?: Record<string, unknown> | null;
  /** When someone last typed into the terminal (0 by default: no view shows it; null: cannot tell). */
  lastInputAt?: () => Promise<number | null>;
}>) {
  const exit = vi.fn();
  const push = fakePushService();
  const followed: Array<number | null> = [];
  // What the follower tells the runner the CLI shows; set before the runner first waits.
  let report: (activity: NativeTerminalActivity) => void = () => undefined;
  const done = runNativeTerminalSession({
    session: params.server.session,
    cli: { command: '/bin/sh', args: ['-c', params.script, 'cli', '--session-id', 'c-1'] },
    cwd: params.cwd,
    env: { ...process.env, OUT: join(params.cwd, 'out.txt') },
    follow: ({ childPid, reportActivity }) => {
      followed.push(childPid);
      report = reportActivity;
      return async () => {
        params.server.calls.push('stop-following');
      };
    },
    agentId: 'claude',
    notifications: push.notifications(),
    readAccountSettings: () => (params.settings === null
      ? null
      : { settings: accountSettingsParse(params.settings ?? {}), settingsSecretsReadKeys: [] }),
    readLastInputAt: params.lastInputAt ?? (async () => 0),
    process: new EventEmitter(),
    exit,
    ...(params.holdFailedExit ? { holdFailedExit: params.holdFailedExit } : {}),
    logPrefix: '[test-terminal]',
  });
  return { done, exit, followed, push, report: (activity: NativeTerminalActivity) => report(activity) };
}

const LOOPS_UNTIL_STOPPED = 'trap "echo stopped > \\"$OUT\\"; exit 0" TERM; while :; do sleep 0.1; done';

describe('runNativeTerminalSession', () => {
  it('runs the CLI in the session folder, follows its process, and ends the session when the CLI exits', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();

    const { done, exit, followed, push } = runWith({
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
    // The user quit the CLI themselves: nobody needs telling.
    expect(push.sent).toEqual([]);
    expect(server.agentState().terminalWaiting).toBeUndefined();
  });

  it('stops the CLI when the app stops the session', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { done, exit, push } = runWith({
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
    // The app stopped it, so nobody needs telling.
    expect(push.sent).toEqual([]);
  });

  it('keeps a failed CLI on screen until the user closes it, and never asks the daemon for a restart', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    let release: () => void = () => undefined;
    const holdFailedExit = vi.fn((_code: number) => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const { done, exit, push } = runWith({
      server,
      cwd,
      script: 'exit 3',
      holdFailedExit,
    });

    await vi.waitFor(() => expect(holdFailedExit).toHaveBeenCalledWith(3));
    // The CLI is gone: the user hears about it at once, and the session waits for them while its
    // last words stay on screen.
    await vi.waitFor(() => expect(push.sent.map((sent) => sent.body)).toEqual(['Claude Code exited with code 3']));
    expect(server.agentState().terminalWaiting).toEqual({ on: 'exited', exitCode: 3, since: expect.any(Number) });
    expect(server.calls).toEqual(['stop-following']);
    release();
    await done;

    expect(server.agentState().terminalWaiting).toBeNull();
    expect(server.calls).toEqual(['stop-following', 'death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('clears what the terminal waited for before the timed shutdown starts when the user quits the CLI', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const push = fakePushService();
    const previousTimeout = process.env.PIGGERCODE_RUNNER_TERMINATION_TIMEOUT_MS;
    process.env.PIGGERCODE_RUNNER_TERMINATION_TIMEOUT_MS = '250';
    // The relay takes the prompt at once, then becomes slower than the shutdown may wait.
    const record = vi.mocked(server.session.updateAgentState).getMockImplementation()!;
    let writes = 0;
    vi.mocked(server.session.updateAgentState).mockImplementation(async (handler) => {
      writes += 1;
      if (writes === 2) await new Promise((resolve) => setTimeout(resolve, 800));
      return record(handler);
    });
    try {
      const exit = vi.fn();
      await runNativeTerminalSession({
        session: server.session,
        cli: { command: '/bin/sh', args: ['-c', 'sleep 0.3'] },
        cwd,
        env: process.env,
        follow: ({ reportActivity }) => {
          reportActivity({ kind: 'waiting', on: 'permission' });
          return async () => undefined;
        },
        agentId: 'claude',
        notifications: push.notifications(),
        readAccountSettings: () => null,
        process: new EventEmitter(),
        exit,
        logPrefix: '[test-terminal]',
      });

      expect(server.agentState().terminalWaiting).toBeNull();
      expect(server.calls).toEqual(['death', 'close']);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      if (previousTimeout === undefined) delete process.env.PIGGERCODE_RUNNER_TERMINATION_TIMEOUT_MS;
      else process.env.PIGGERCODE_RUNNER_TERMINATION_TIMEOUT_MS = previousTimeout;
    }
  });

  it('tells the app at once when the CLI starts working and when it is done', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { done, report } = runWith({ server, cwd, script: 'sleep 0.5' });

    vi.mocked(server.session.keepAlive).mockClear();
    report({ kind: 'working' });
    expect(server.session.keepAlive).toHaveBeenLastCalledWith(true, 'local');
    report({ kind: 'idle' });
    expect(server.session.keepAlive).toHaveBeenLastCalledWith(false, 'local');
    await done;
    expect(server.turns.map((turn) => turn.action)).toEqual(['begin', 'complete']);
  });

  it('stops a CLI left unused past the account\'s limit, as the app\'s stop would, but never one that works, asks, runs a shell or is typed into', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      let typedAt = 0;
      const { done, exit, report } = runWith({
        server,
        cwd,
        script: LOOPS_UNTIL_STOPPED,
        settings: { sessionIdleStopAfterMinutes: 60 },
        lastInputAt: async () => typedAt,
      });
      const minutes = (count: number) => vi.advanceTimersByTimeAsync(count * 60_000);

      // Before the CLI shows its input box, nothing says it is unused.
      await minutes(120);
      report({ kind: 'working' });
      await minutes(120);
      report({ kind: 'waiting', on: 'question' });
      await minutes(120);
      report({ kind: 'idle', background: true });
      await minutes(120);
      expect(server.calls).toEqual([]);

      report({ kind: 'idle' });
      await minutes(59);
      // The user opens the terminal and starts typing a prompt they have not sent yet, then closes
      // the view (tmux no longer lists a client for it).
      typedAt = Date.now();
      await minutes(2);
      typedAt = 0;
      await minutes(56);
      expect(server.calls).toEqual([]);
      await minutes(3);
      vi.useRealTimers();
      await done;

      expect((await readFile(join(cwd, 'out.txt'), 'utf8')).trim()).toBe('stopped');
      expect(server.calls).toEqual(['stop-following', 'death', 'close']);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never stops an unused CLI when the limit is off, or while the account\'s choice or typing cannot be told', async () => {
    const cases = [
      { settings: { sessionIdleStopAfterMinutes: null } },
      { settings: null },
      { settings: { sessionIdleStopAfterMinutes: 60 }, lastInputAt: async () => null },
    ];
    for (const options of cases) {
      const cwd = await tempDir();
      const server = fakeServerSession();
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      try {
        const { done, report } = runWith({ server, cwd, script: LOOPS_UNTIL_STOPPED, ...options });
        report({ kind: 'idle' });
        await vi.advanceTimersByTimeAsync(48 * 60 * 60_000);
        expect(server.calls).toEqual([]);

        vi.useRealTimers();
        await server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
        await done;
        expect(server.calls).toEqual(['stop-following', 'death', 'close']);
      } finally {
        vi.useRealTimers();
      }
    }
  });
});
