import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { accountSettingsParse } from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeTerminalActivity } from './nativeTerminalActivityReporter';
import { fakePushService, fakeServerSession } from './nativeTerminalSession.testkit';
import {
  runNativeTerminalSession,
  type NativeTerminalCliControl,
  type NativeTerminalCliSpec,
  type NativeTerminalCliSwitcher,
} from './runNativeTerminalSession';

const dirs: string[] = [];
// Every fake CLI a test started: a test that fails (or a CLI the runner never stops) must not leave its loop running.
const startedCliPids = new Set<number>();
afterEach(async () => {
  for (const pid of startedCliPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone: the runner stopped it, as it should.
    }
  }
  startedCliPids.clear();
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
  /** A provider's way to replace its CLI while the session runs. */
  switcher?: NativeTerminalCliSwitcher;
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
      if (typeof childPid === 'number') startedCliPids.add(childPid);
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
    ...(params.switcher ? { switcher: params.switcher } : {}),
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

  it('does not call a turn finished when the CLI shows idle on its way out after being stopped', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { done, push, report } = runWith({
      server,
      cwd,
      // Takes a moment to quit once told to, as a CLI ending its background work does.
      script: 'trap "sleep 0.4; exit 0" TERM; while :; do sleep 0.05; done',
    });
    await vi.waitFor(() => expect(server.handlers.has(RPC_METHODS.KILL_SESSION)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    report({ kind: 'working' });
    report({ kind: 'idle', background: true });

    const stopped = server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
    await new Promise((resolve) => setTimeout(resolve, 100));
    report({ kind: 'idle' });
    await stopped;
    await done;

    expect(server.turns).toEqual([{ action: 'begin', provider: 'claude' }]);
    expect(server.events).toEqual([]);
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

  it('records a turn at once when the CLI starts working and when it is done, without touching it', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { done, report } = runWith({ server, cwd, script: 'sleep 0.5' });

    report({ kind: 'working' });
    expect(server.turns.map((turn) => turn.action)).toEqual(['begin']);
    report({ kind: 'idle' });
    expect(server.turns.map((turn) => turn.action)).toEqual(['begin', 'complete']);
    await done;
    // A heartbeat that says "thinking" would touch the turn and move the time the app reads as its
    // start; the turn record alone says the CLI is working.
    expect(server.session.keepAlive).not.toHaveBeenCalledWith(true, expect.anything());
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

describe('runNativeTerminalSession replacing the CLI', () => {
  /** A CLI that logs when it starts and when it is stopped, and runs until stopped. */
  const logging = (name: string, cwd: string): NativeTerminalCliSpec => ({
    cli: {
      command: '/bin/sh',
      args: ['-c', `echo ${name}-start >> "$OUT"; trap 'echo ${name}-stopped >> "$OUT"; exit 0' TERM; while :; do sleep 0.05; done`],
    },
    env: { ...process.env, OUT: join(cwd, 'out.txt') },
    follow: ({ childPid, reportStarted }) => {
      if (typeof childPid === 'number') startedCliPids.add(childPid);
      reportStarted();
      return async () => undefined;
    },
  });
  /** A CLI that exits at once with a failure, as one that could not start on a login does. */
  const failing = (cwd: string): NativeTerminalCliSpec => ({
    cli: { command: '/bin/sh', args: ['-c', 'echo failing-start >> "$OUT"; exit 3'] },
    env: { ...process.env, OUT: join(cwd, 'out.txt') },
    follow: () => async () => undefined,
  });
  const lines = async (cwd: string) => (await readFile(join(cwd, 'out.txt'), 'utf8')).trim().split('\n');

  /** A switcher that runs `act` once with the session's control, and tells when it is done. */
  function switcherThat(act: (control: NativeTerminalCliControl) => Promise<void>) {
    let done: Promise<void> = Promise.resolve();
    const switcher: NativeTerminalCliSwitcher = {
      start: (control) => {
        done = act(control);
        return async () => {
          await done;
        };
      },
    };
    return { switcher, done: () => done };
  }

  it('stops the CLI and waits for it to exit before starting the next one, and the session never ends in between', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const next = logging('second', cwd);
    const started: boolean[] = [];
    const { switcher, done } = switcherThat(async (control) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const result = await control.replace(next);
      if (result.kind !== 'running') throw new Error('not running');
      started.push(await result.cli.started);
      result.cli.settle();
    });
    const { done: finished, exit, push } = runWith({
      server,
      cwd,
      script: 'echo first-start >> "$OUT"; trap "echo first-stopped >> \\"$OUT\\"; exit 0" TERM; while :; do sleep 0.05; done',
      switcher,
    });

    await done();
    expect(started).toEqual([true]);
    // The first CLI's exit did not end the session: only its follower was stopped.
    expect(server.calls).toEqual(['stop-following']);
    expect(exit).not.toHaveBeenCalled();
    await server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
    await finished;

    expect(await lines(cwd)).toEqual(['first-start', 'first-stopped', 'second-start', 'second-stopped']);
    expect(server.calls).toEqual(['stop-following', 'death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
    expect(push.sent).toEqual([]);
  });

  it('follows each CLI it starts, and stops following the old one before the new one starts', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const order: string[] = [];
    const next: NativeTerminalCliSpec = {
      ...logging('second', cwd),
      beforeStart: async () => {
        order.push('before-start-second');
      },
      follow: ({ childPid, reportStarted }) => {
        if (typeof childPid === 'number') startedCliPids.add(childPid);
        order.push('follow-second');
        reportStarted();
        return async () => {
          order.push('stop-following-second');
        };
      },
    };
    const { switcher, done } = switcherThat(async (control) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const result = await control.replace(next);
      if (result.kind === 'running') result.cli.settle();
    });
    const { done: finished } = runWith({
      server,
      cwd,
      script: 'trap "exit 0" TERM; while :; do sleep 0.05; done',
      switcher,
    });
    await done();
    await server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
    await finished;
    // The first CLI's follower is the test harness's: its stop is recorded in the server calls.
    expect(server.calls.indexOf('stop-following')).toBeGreaterThanOrEqual(0);
    expect(order).toEqual(['before-start-second', 'follow-second', 'stop-following-second']);
  });

  it('leaves the running CLI alone when what the next one needs cannot be prepared', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const results: string[] = [];
    const { switcher, done } = switcherThat(async (control) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const result = await control.replace({
        ...logging('second', cwd),
        beforeStart: async () => {
          throw new Error('no space left');
        },
      });
      results.push(result.kind, String(control.current().isRunning()), String(control.isEnding()));
    });
    const { done: finished } = runWith({
      server,
      cwd,
      script: 'echo first-start >> "$OUT"; trap "echo first-stopped >> \\"$OUT\\"; exit 0" TERM; while :; do sleep 0.05; done',
      switcher,
    });
    await done();
    expect(results).toEqual(['failed', 'true', 'false']);
    await server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
    await finished;
    // Never started a second one, and the first one was stopped only by the session's own end.
    expect(await lines(cwd)).toEqual(['first-start', 'first-stopped']);
  });

  it('keeps the session while a replacement that did not start is replaced again, and ends it when that fails too', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const outcome: string[] = [];
    const { switcher, done } = switcherThat(async (control) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const target = await control.replace(failing(cwd));
      if (target.kind !== 'running') throw new Error('ended');
      outcome.push(`target-started:${await target.cli.started}`);
      const source = await control.replace(failing(cwd));
      if (source.kind !== 'running') throw new Error('ended');
      outcome.push(`source-started:${await source.cli.started}`);
      source.cli.settle();
    });
    const released = vi.fn(async (_code: number) => undefined);
    const { done: finished, exit } = runWith({
      server,
      cwd,
      script: 'trap "exit 0" TERM; while :; do sleep 0.05; done',
      switcher,
      holdFailedExit: released,
    });
    await finished;
    await done();

    expect(outcome).toEqual(['target-started:false', 'source-started:false']);
    expect(await lines(cwd)).toEqual(['failing-start', 'failing-start']);
    // Only the last failure ended the session, and its terminal was held for the user to read it.
    expect(released).toHaveBeenCalledWith(3);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('starts nothing when the app stops the session first: a manual stop wins over a replacement', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const seen: string[] = [];
    let stop: Promise<unknown> = Promise.resolve();
    const { switcher, done } = switcherThat(async (control) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      stop = Promise.resolve(server.handlers.get(RPC_METHODS.KILL_SESSION)!({}));
      const result = await control.replace(logging('second', cwd));
      seen.push(result.kind);
    });
    const { done: finished } = runWith({
      server,
      cwd,
      script: 'echo first-start >> "$OUT"; trap "exit 0" TERM; while :; do sleep 0.05; done',
      switcher,
    });
    await finished;
    await done();
    await stop;
    expect(seen).toEqual(['ended']);
    expect(await lines(cwd)).toEqual(['first-start']);
  });

  it('ends the session when the CLI that replaced the first one quits by itself', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { switcher, done } = switcherThat(async (control) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await control.replace({
        ...logging('second', cwd),
        cli: { command: '/bin/sh', args: ['-c', 'sleep 0.3'] },
      });
      if (result.kind === 'running') result.cli.settle();
    });
    const { done: finished, exit } = runWith({ server, cwd, script: 'trap "exit 0" TERM; while :; do sleep 0.05; done', switcher });
    await finished;
    await done();
    // The second CLI ran for its 0.3 s and quit: that, not the first one's stop, ended the session.
    expect(exit).toHaveBeenCalledWith(0);
    expect(server.calls).toEqual(['stop-following', 'death', 'close']);
  });
});
