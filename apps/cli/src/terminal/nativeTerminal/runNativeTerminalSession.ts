import { spawn, type ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';

import { resolveWindowsCommandInvocation } from '@piggercode/cli-common/process';

import { registerRunnerTerminationHandlers } from '@/agent/runtime/runnerTerminationHandlers';
import { startSessionHeartbeatLoop } from '@/agent/runtime/session/startSessionHeartbeatLoop';
import type { ApiSessionClient } from '@/api/session/sessionClient';
import { registerKillSessionHandler } from '@/rpc/handlers/killSession';
import { logger } from '@/ui/logger';

export type NativeTerminalSessionClient = Pick<
  ApiSessionClient,
  'sessionId' | 'keepAlive' | 'updateMetadata' | 'sendSessionDeath' | 'close' | 'rpcHandlerManager'
>;

/**
 * Follows what the CLI does with its conversation while it runs (which conversation it writes,
 * the title it gets) and records it on the session. Returns how to stop following.
 */
export type NativeTerminalFollower = (params: Readonly<{
  session: NativeTerminalSessionClient;
  /** The CLI's process, when it started. */
  childPid: number | null;
}>) => () => Promise<void>;

type ProcessLike = Pick<EventEmitter, 'on' | 'removeListener'>;

export type RunNativeTerminalSessionParams = Readonly<{
  session: NativeTerminalSessionClient;
  cli: Readonly<{ command: string; args: readonly string[] }>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  follow: NativeTerminalFollower;
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
 * when the CLI exits or the app stops it. It writes nothing to the terminal while the CLI runs.
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

  const heartbeat = startSessionHeartbeatLoop({
    getThinking: () => false,
    getMode: () => 'local',
    keepAlive: (thinking, mode) => session.keepAlive(thinking, mode),
  });
  const stopFollowing = params.follow({ session, childPid: typeof child.pid === 'number' ? child.pid : null });

  const termination = registerRunnerTerminationHandlers({
    process: params.process,
    exit: params.exit,
    sessionExitReport: { sessionId: session.sessionId },
    onTerminate: async () => {
      if (cliRunning) child.kill('SIGTERM');
      await cliExit;
      clearInterval(heartbeat);
      await stopFollowing();
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
  if (exitCode !== 0 && params.holdFailedExit) {
    await Promise.race([params.holdFailedExit(exitCode), termination.whenTerminated]);
  }
  // Quitting the CLI is the user's own way out, so the session ends as planned, never as a crash
  // the daemon would restart.
  termination.requestTermination({ kind: 'exit', code: 0 });
  await termination.whenTerminated;
}
