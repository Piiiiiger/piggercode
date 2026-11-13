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
}>) => () => Promise<void>;

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
  const invocation = resolveWindowsCommandInvocation({
    command: params.cli.command,
    args: [...params.cli.args],
    env: params.env,
  });
  const child: ChildProcess = spawn(invocation.command, invocation.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: 'inherit',
    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  let cliRunning = true;
  const cliExit = new Promise<number>((resolve) => {
    child.once('error', (error) => {
      logger.debug(`${params.logPrefix} The CLI could not start`, error);
      cliRunning = false;
      resolve(127);
    });
    child.once('exit', (code, signal) => {
      cliRunning = false;
      resolve(typeof code === 'number' ? code : signal ? 128 : 1);
    });
  });

  const sendHeartbeat = (thinking: boolean): void => {
    session.keepAlive(thinking, 'local');
    activity.retryUnsaved();
  };
  const activity = createNativeTerminalActivityReporter({
    session,
    agentName: params.notifications.agentName,
    agentId: params.agentId,
    logPrefix: params.logPrefix,
    pushSender: params.notifications.pushSender,
    readAccountSettings: params.readAccountSettings,
    // The app learns at once that a turn started or ended, not at the next heartbeat.
    onTurnRunningChange: (running) => sendHeartbeat(running),
  });
  const heartbeat = startSessionHeartbeatLoop({
    getThinking: () => activity.turnRunning(),
    getMode: () => 'local',
    keepAlive: (thinking) => sendHeartbeat(thinking),
  });
  const stopFollower = params.follow({
    session,
    childPid: typeof child.pid === 'number' ? child.pid : null,
    reportActivity: activity.report,
  });
  let following: Promise<void> | null = null;
  const stopFollowing = () => (following ??= stopFollower());
  // Set before the CLI is stopped, so its exit is not mistaken for the user quitting it.
  let stopping = false;

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
      if (cliRunning) child.kill('SIGTERM');
      await cliExit;
      clearInterval(heartbeat);
      await stopFollowing();
      await activity.end();
      await session.sendSessionDeath();
      await session.close();
    },
  });
  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    termination.requestTermination({ kind: 'killSession' });
    await termination.whenTerminated;
  });

  const exitCode = await cliExit;
  logger.debug(`${params.logPrefix} The CLI exited with code ${exitCode}`);
  // The user quit the CLI: its report goes out while the screen below shows, and is done before the
  // timed shutdown starts, so a slow relay cannot cut the session's end short.
  const exitReported = stopping ? Promise.resolve() : stopFollowing().then(() => activity.cliExited(exitCode));
  if (exitCode !== 0 && params.holdFailedExit) {
    await Promise.race([params.holdFailedExit(exitCode), termination.whenTerminated]);
  }
  await exitReported;
  // Quitting the CLI is the user's own way out, so the session ends as planned, never as a crash
  // the daemon would restart.
  termination.requestTermination({ kind: 'exit', code: 0 });
  await termination.whenTerminated;
}
