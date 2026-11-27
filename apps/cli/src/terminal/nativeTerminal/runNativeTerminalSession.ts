import { spawn, type ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';

import { resolveWindowsCommandInvocation } from '@piggercode/cli-common/process';
import { resolveSessionIdleStopAfterMinutes } from '@piggercode/protocol';

import { registerRunnerTerminationHandlers } from '@/agent/runtime/runnerTerminationHandlers';
import { startSessionHeartbeatLoop } from '@/agent/runtime/session/startSessionHeartbeatLoop';
import type { ApiSessionClient } from '@/api/session/sessionClient';
import { registerKillSessionHandler } from '@/rpc/handlers/killSession';
import { logger } from '@/ui/logger';

import {
  createNativeTerminalActivityReporter,
  type NativeTerminalActivity,
  type NativeTerminalAccountSettings,
  type NativeTerminalActivitySession,
} from './nativeTerminalActivityReporter';
import { readTerminalLastInputAt } from './terminalInputActivity';

export type NativeTerminalSessionClient = NativeTerminalActivitySession & Pick<
  ApiSessionClient,
  'sessionId' | 'keepAlive' | 'updateMetadata' | 'sendSessionDeath' | 'close' | 'rpcHandlerManager'
>;

/**
 * Follows what the CLI does with its conversation while it runs (which conversation it writes,
 * the title it gets) and records it on the session, and tells `reportActivity` what the CLI shows
 * (working, waiting at a prompt, idle). Returns how to stop following.
 */
export type NativeTerminalFollower = (params: Readonly<{
  session: NativeTerminalSessionClient;
  /** The CLI's process, when it started. */
  childPid: number | null;
  reportActivity: (activity: NativeTerminalActivity) => void;
  /** The CLI showed its first readable state: it started (a CLI that exits before this did not start). */
  reportStarted: () => void;
}>) => () => Promise<void>;

/** One CLI process of a session, how to run it and follow it. */
export type NativeTerminalCliSpec = Readonly<{
  cli: Readonly<{ command: string; args: readonly string[] }>;
  env: NodeJS.ProcessEnv;
  follow: NativeTerminalFollower;
  /** Runs once the session is registered, right before the CLI starts. */
  beforeStart?: () => Promise<void>;
}>;

/** A CLI process the runner started. */
export type NativeTerminalCliHandle = Readonly<{
  /** The exit code, once the process has exited. */
  exited: Promise<number>;
  /** True once its follower reported it started; false when it exited first. */
  started: Promise<boolean>;
  isRunning: () => boolean;
  /**
   * Ends the hold a replacement puts on the session: while it is held, this process exiting does not end the
   * session, so the provider can start another one in its place. Call it once this process is the one to keep.
   */
  settle: () => void;
}>;

export type NativeTerminalCliControl = Readonly<{
  session: NativeTerminalSessionClient;
  /** The CLI running now (the first one when the switcher starts). */
  current: () => NativeTerminalCliHandle;
  /**
   * Stops the running CLI, waits until it has exited, and starts `spec` in the same terminal in its place.
   * The session stays held (see `settle`) until the provider settles the new CLI or replaces it again. `ended`:
   * the session is ending (the app stopped it, or the CLI quit by itself), so nothing starts: a manual stop
   * always wins over a replacement. `failed`: what the new CLI needed before it could start (`beforeStart`)
   * could not be prepared; the running CLI was not touched.
   */
  replace: (spec: NativeTerminalCliSpec) => Promise<Readonly<
    { kind: 'running'; cli: NativeTerminalCliHandle } | { kind: 'ended' } | { kind: 'failed' }
  >>;
  /** The session is ending (stopped from the app, or the CLI quit by itself): a CLI that exits now is not a failed start. */
  isEnding: () => boolean;
  /** When someone last typed into the terminal; see `RunNativeTerminalSessionParams.readLastInputAt`. */
  readLastInputAt: () => Promise<number | null>;
}>;

/**
 * A provider's way to replace its CLI while the session runs (agy moving to another login): starts once the
 * session runs and returns how to stop. It decides when and what to start; `replace` does the process work.
 */
export type NativeTerminalCliSwitcher = Readonly<{
  start: (control: NativeTerminalCliControl) => () => Promise<void>;
}>;

/** How the session reaches the user's devices when a turn ends, a prompt waits or the CLI quits. */
export type NativeTerminalNotifications = Readonly<{
  /** The CLI's name in notifications, e.g. "Claude Code". */
  agentName: string;
  pushSender: Parameters<typeof createNativeTerminalActivityReporter>[0]['pushSender'];
}>;

/** How often the runner looks whether its CLI has sat unused for longer than the account allows. */
const IDLE_STOP_CHECK_INTERVAL_MS = 60_000;

type ProcessLike = Pick<EventEmitter, 'on' | 'removeListener'>;

export type RunNativeTerminalSessionParams = Readonly<{
  session: NativeTerminalSessionClient;
  cli: Readonly<{ command: string; args: readonly string[] }>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  follow: NativeTerminalFollower;
  /** Replaces the CLI while the session runs, when the provider can (absent: the CLI runs until it exits). */
  switcher?: NativeTerminalCliSwitcher;
  /** The agent the session's turn records name, e.g. "claude". */
  agentId: string;
  notifications: NativeTerminalNotifications;
  /**
   * The account's settings as last read, without waiting for the relay (null while unknown): the
   * notification choices, and how long the CLI may sit unused (`sessionIdleStopAfterMinutes`).
   */
  readAccountSettings: () => NativeTerminalAccountSettings | null;
  /**
   * When someone last typed into the terminal from a view of it (0: no view shows it), or null when
   * that cannot be told. Defaults to asking tmux.
   */
  readLastInputAt?: () => Promise<number | null>;
  process: ProcessLike;
  exit: (code: number) => void;
  /**
   * After the CLI fails, keeps its last words on screen until the user is done reading them
   * (the window closes when this resolves). Absent: close at once.
   */
  holdFailedExit?: (exitCode: number) => Promise<void>;
  logPrefix: string;
}>;

/**
 * One 「终端」 session: the CLI owns the terminal (stdin, stdout and stderr are its own), and this
 * runner only keeps the PiggerCode session alive, follows the conversation, and ends the session
 * when the CLI exits, the app stops it, or the CLI sat unused for longer than the account allows
 * (stopped the way the app stops it; reopening resumes the conversation). It writes nothing to the
 * terminal while the CLI runs.
 */
export async function runNativeTerminalSession(params: RunNativeTerminalSessionParams): Promise<void> {
  const { session } = params;

  const activity = createNativeTerminalActivityReporter({
    session,
    agentName: params.notifications.agentName,
    agentId: params.agentId,
    logPrefix: params.logPrefix,
    pushSender: params.notifications.pushSender,
    readAccountSettings: params.readAccountSettings,
  });
  // The session's turn record says when the CLI works. The heartbeat keeps saying "not thinking":
  // a thinking heartbeat touches the open turn, which moves the time the app reads as its start.
  const heartbeat = startSessionHeartbeatLoop({
    getThinking: () => false,
    getMode: () => 'local',
    keepAlive: (thinking, mode) => {
      session.keepAlive(thinking, mode);
      activity.retryUnsaved();
    },
  });
  // Set before the CLI is stopped, so its exit is not mistaken for the user quitting it, and what it
  // shows on the way out (idle, its background work ended by the stop) for a turn that finished.
  let stopping = false;

  type RunningCli = {
    child: ChildProcess;
    running: boolean;
    exited: Promise<number>;
    started: Promise<boolean>;
    /** Replaced: what it shows on the way out is not reported. */
    retired: boolean;
    stopFollowing: () => Promise<void>;
  };

  const startCli = (spec: NativeTerminalCliSpec): RunningCli => {
    const invocation = resolveWindowsCommandInvocation({
      command: spec.cli.command,
      args: [...spec.cli.args],
      env: spec.env,
    });
    const child: ChildProcess = spawn(invocation.command, invocation.args, {
      cwd: params.cwd,
      env: spec.env,
      stdio: 'inherit',
      ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    let resolveStarted: (started: boolean) => void = () => undefined;
    const started = new Promise<boolean>((resolve) => {
      resolveStarted = resolve;
    });
    const running: RunningCli = {
      child,
      running: true,
      retired: false,
      started,
      exited: new Promise<number>((resolve) => {
        child.once('error', (error) => {
          logger.debug(`${params.logPrefix} The CLI could not start`, error);
          running.running = false;
          resolveStarted(false);
          resolve(127);
        });
        child.once('exit', (code, signal) => {
          running.running = false;
          resolveStarted(false);
          resolve(typeof code === 'number' ? code : signal ? 128 : 1);
        });
      }),
      stopFollowing: async () => undefined,
    };
    const stopFollower = spec.follow({
      session,
      childPid: typeof child.pid === 'number' ? child.pid : null,
      reportActivity: (shown) => {
        if (!stopping && !running.retired) activity.report(shown);
      },
      reportStarted: () => resolveStarted(true),
    });
    let following: Promise<void> | null = null;
    running.stopFollowing = () => (following ??= stopFollower());
    return running;
  };

  let current = startCli({ cli: params.cli, env: params.env, follow: params.follow });
  // While a replacement is being decided the CLI exiting does not end the session (see `settle`).
  type Hold = Readonly<{ promise: Promise<void>; release: () => void }>;
  // In an object, so what is read where the session waits is what the closures last wrote.
  const held: { hold: Hold | null } = { hold: null };
  let ended = false;
  const takeHold = (): Hold => {
    held.hold?.release();
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mine = { promise, release };
    held.hold = mine;
    return mine;
  };
  const handleOf = (cli: RunningCli, mine: { release: () => void } | null): NativeTerminalCliHandle => ({
    exited: cli.exited,
    started: cli.started,
    isRunning: () => cli.running,
    settle: () => {
      if (mine && held.hold === mine) held.hold = null;
      mine?.release();
    },
  });
  const replace: NativeTerminalCliControl['replace'] = async (spec) => {
    if (stopping || ended || (!held.hold && !current.running)) return { kind: 'ended' };
    // Prepared before anything is stopped: a failure leaves the running CLI as it was.
    try {
      await spec.beforeStart?.();
    } catch (error) {
      logger.infoFile(`${params.logPrefix} Could not prepare the replacement CLI`, error instanceof Error ? error.message : String(error));
      return { kind: 'failed' };
    }
    if (stopping || ended || (!held.hold && !current.running)) return { kind: 'ended' };
    const mine = takeHold();
    const old = current;
    old.retired = true;
    if (old.running) old.child.kill('SIGTERM');
    await old.exited;
    await old.stopFollowing();
    // A stop from the app wins: nothing starts once the session is ending.
    if (stopping || ended) {
      mine.release();
      if (held.hold === mine) held.hold = null;
      return { kind: 'ended' };
    }
    current = startCli(spec);
    return { kind: 'running', cli: handleOf(current, mine) };
  };

  let stopSwitcher: (() => Promise<void>) | null = null;

  // A CLI left unused for longer than the account allows is stopped the way the app stops it: its
  // input box showing with nothing running, and nobody typing into it. Whatever cannot be told (the
  // account's choice, the CLI's state, typing) keeps the session running.
  const readLastInputAt = params.readLastInputAt ?? (() => readTerminalLastInputAt());
  // The latest typing seen at any look, so a view closed right after typing still counts it.
  let lastSeenInputAt = 0;
  const stopIfUnused = async (): Promise<void> => {
    if (activity.quietSince() === null) return;
    const inputAt = await readLastInputAt();
    if (inputAt === null) return;
    lastSeenInputAt = Math.max(lastSeenInputAt, inputAt);
    // Read after the look, so a choice changed meanwhile ("never", a longer time) counts.
    const known = params.readAccountSettings();
    const stopAfterMinutes = known ? resolveSessionIdleStopAfterMinutes(known.settings) : null;
    const quietSince = activity.quietSince();
    if (stopAfterMinutes === null || quietSince === null || stopping) return;
    if (Date.now() - Math.max(quietSince, lastSeenInputAt) < stopAfterMinutes * 60_000) return;
    logger.infoFile(`${params.logPrefix} The CLI sat unused for ${stopAfterMinutes} min: stopping the session`);
    termination.requestTermination({ kind: 'killSession' });
  };
  let idleCheckRunning = false;
  const idleStopCheck = setInterval(() => {
    if (idleCheckRunning || stopping) return;
    idleCheckRunning = true;
    void stopIfUnused()
      .catch((error) => logger.infoFile(`${params.logPrefix} Could not check whether the CLI is unused`, error))
      .finally(() => {
        idleCheckRunning = false;
      });
  }, IDLE_STOP_CHECK_INTERVAL_MS);
  idleStopCheck.unref?.();

  const termination = registerRunnerTerminationHandlers({
    process: params.process,
    exit: params.exit,
    sessionExitReport: { sessionId: session.sessionId },
    onTerminate: async () => {
      stopping = true;
      clearInterval(idleStopCheck);
      const last = current;
      if (last.running) last.child.kill('SIGTERM');
      await last.exited;
      // A replacement waiting on this CLI to start now sees it exited and, finding the session ending, starts nothing.
      held.hold?.release();
      held.hold = null;
      await stopSwitcher?.();
      clearInterval(heartbeat);
      await last.stopFollowing();
      await activity.end();
      await session.sendSessionDeath();
      await session.close();
    },
  });
  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    termination.requestTermination({ kind: 'killSession' });
    await termination.whenTerminated;
  });
  if (params.switcher) {
    stopSwitcher = params.switcher.start({
      session,
      current: () => handleOf(current, null),
      replace,
      isEnding: () => stopping || ended,
      readLastInputAt,
    });
  }

  let exitCode: number;
  for (;;) {
    exitCode = await current.exited;
    if (!held.hold) break;
    await held.hold.promise;
  }
  ended = true;
  logger.debug(`${params.logPrefix} The CLI exited with code ${exitCode}`);
  // The user quit the CLI: its report goes out while the screen below shows, and is done before the
  // timed shutdown starts, so a slow relay cannot cut the session's end short.
  const exitReported = stopping ? Promise.resolve() : current.stopFollowing().then(() => activity.cliExited(exitCode));
  if (exitCode !== 0 && params.holdFailedExit) {
    await Promise.race([params.holdFailedExit(exitCode), termination.whenTerminated]);
  }
  await exitReported;
  // Quitting the CLI is the user's own way out, so the session ends as planned, never as a crash
  // the daemon would restart.
  termination.requestTermination({ kind: 'exit', code: 0 });
  await termination.whenTerminated;
}
