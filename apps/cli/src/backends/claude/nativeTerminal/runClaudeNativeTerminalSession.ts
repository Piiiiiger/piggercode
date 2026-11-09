import { spawn, type ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';

import { resolveWindowsCommandInvocation } from '@piggercode/cli-common/process';

import { applyProviderSessionInfoUpdate } from '@/agent/acp/runtime/providerSessionInfoState';
import { registerRunnerTerminationHandlers } from '@/agent/runtime/runnerTerminationHandlers';
import { startSessionHeartbeatLoop } from '@/agent/runtime/session/startSessionHeartbeatLoop';
import type { ApiSessionClient } from '@/api/session/sessionClient';
import { startFileWatcher } from '@/integrations/watcher/startFileWatcher';
import { registerKillSessionHandler } from '@/rpc/handlers/killSession';
import { logger } from '@/ui/logger';

import { createClaudeTranscriptTitleFollower } from './claudeTranscriptTitleFollower';

export type NativeTerminalSessionClient = Pick<
  ApiSessionClient,
  'sessionId' | 'keepAlive' | 'updateMetadata' | 'sendSessionDeath' | 'close' | 'rpcHandlerManager'
>;

type ProcessLike = Pick<EventEmitter, 'on' | 'removeListener'>;

export type RunClaudeNativeTerminalSessionParams = Readonly<{
  session: NativeTerminalSessionClient;
  claude: Readonly<{ command: string; args: readonly string[] }>;
  claudeSessionId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  transcriptPath: string;
  process: ProcessLike;
  exit: (code: number) => void;
  /**
   * After Claude fails, keeps its last words on screen until the user is done reading them
   * (the window closes when this resolves). Absent: close at once.
   */
  holdFailedExit?: (exitCode: number) => Promise<void>;
}>;

/**
 * One 「终端」 session: `claude` owns the terminal (stdin, stdout and stderr are its own), and this
 * runner only keeps the PiggerCode session alive, follows Claude's title, and ends the session when
 * Claude exits or the app stops it. It writes nothing to the terminal while Claude runs.
 */
export async function runClaudeNativeTerminalSession(params: RunClaudeNativeTerminalSessionParams): Promise<void> {
  const { session } = params;
  const invocation = resolveWindowsCommandInvocation({
    command: params.claude.command,
    args: [...params.claude.args],
    env: params.env,
  });
  const child: ChildProcess = spawn(invocation.command, invocation.args, {
    cwd: params.cwd,
    env: params.env,
    stdio: 'inherit',
    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  let claudeRunning = true;
  const claudeExit = new Promise<number>((resolve) => {
    child.once('error', (error) => {
      logger.debug('[claude-terminal] Claude Code could not start', error);
      claudeRunning = false;
      resolve(127);
    });
    child.once('exit', (code, signal) => {
      claudeRunning = false;
      resolve(typeof code === 'number' ? code : signal ? 128 : 1);
    });
  });

  const heartbeat = startSessionHeartbeatLoop({
    getThinking: () => false,
    getMode: () => 'local',
    keepAlive: (thinking, mode) => session.keepAlive(thinking, mode),
  });
  const stopTitleFollower = followClaudeTitle({ session, transcriptPath: params.transcriptPath, claudeSessionId: params.claudeSessionId });

  const termination = registerRunnerTerminationHandlers({
    process: params.process,
    exit: params.exit,
    sessionExitReport: { sessionId: session.sessionId },
    onTerminate: async () => {
      if (claudeRunning) child.kill('SIGTERM');
      await claudeExit;
      clearInterval(heartbeat);
      await stopTitleFollower();
      await session.sendSessionDeath();
      await session.close();
    },
  });
  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    termination.requestTermination({ kind: 'killSession' });
    await termination.whenTerminated;
  });

  const exitCode = await claudeExit;
  logger.debug(`[claude-terminal] Claude Code exited with code ${exitCode}`);
  if (exitCode !== 0 && params.holdFailedExit) {
    await Promise.race([params.holdFailedExit(exitCode), termination.whenTerminated]);
  }
  // Claude ending is the user's own way out, so the session ends as planned, never as a crash the
  // daemon would restart.
  termination.requestTermination({ kind: 'exit', code: 0 });
  await termination.whenTerminated;
}

function followClaudeTitle(params: Readonly<{
  session: NativeTerminalSessionClient;
  transcriptPath: string;
  claudeSessionId: string;
}>): () => Promise<void> {
  const follower = createClaudeTranscriptTitleFollower(params.transcriptPath);
  let reading = false;
  let readAgain = false;
  const read = async (): Promise<void> => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      do {
        readAgain = false;
        const title = await follower.readChanges();
        if (title) {
          await params.session.updateMetadata((metadata) => applyProviderSessionInfoUpdate({
            metadata,
            provider: 'claude',
            sessionId: params.claudeSessionId,
            observedAt: Date.now(),
            update: { title },
          }));
        }
      } while (readAgain);
    } catch (error) {
      logger.debug('[claude-terminal] Could not read the Claude title', error);
    } finally {
      reading = false;
    }
  };
  return startFileWatcher(params.transcriptPath, () => {
    void read();
  });
}
