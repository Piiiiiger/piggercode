import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { applyProviderSessionInfoUpdate } from '@/agent/acp/runtime/providerSessionInfoState';
import { prepareClaudeSubprocessEnv } from '@/backends/claude/spawn/buildClaudeSubprocessEnv';
import { resolveClaudeSessionEnvOverlay } from '@/backends/claude/spawn/resolveClaudeSessionEnvOverlay';
import { getProjectPath } from '@/backends/claude/utils/path';
import { startFileWatcher } from '@/integrations/watcher/startFileWatcher';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import type { NativeTerminalProvider } from '@/terminal/nativeTerminal/runNativeTerminal';
import type { NativeTerminalSessionClient } from '@/terminal/nativeTerminal/runNativeTerminalSession';
import { logger } from '@/ui/logger';

import { planClaudeNativeTerminalLaunch } from './claudeNativeTerminalLaunch';
import { createClaudeTranscriptTitleFollower } from './claudeTranscriptTitleFollower';

/** Native Claude Code as a 「终端」 session: `claude` with only the conversation to open. */
export const claudeNativeTerminal: NativeTerminalProvider = {
  flavor: 'claude',
  name: 'Claude Code',
  logPrefix: '[claude-terminal]',
  planLaunch: ({ directory, resumeId, firstPrompt }) => {
    const projectDir = getProjectPath(directory);
    const launch = planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: resumeId,
      firstPrompt,
      transcriptExists: (claudeSessionId) => existsSync(join(projectDir, `${claudeSessionId}.jsonl`)),
      newClaudeSessionId: randomUUID,
    });
    const claude = requireProviderCliLaunchSpec('claude', { processEnv: process.env });
    const transcriptPath = join(projectDir, `${launch.claudeSessionId}.jsonl`);
    return {
      cli: { command: claude.command, args: [...claude.args, ...launch.args] },
      env: claudeNativeTerminalEnv({ baseEnv: process.env, directory }),
      metadata: { claudeSessionId: launch.claudeSessionId },
      // Claude creates this folder with the first message; the title watcher needs it before.
      beforeStart: async () => {
        await mkdir(projectDir, { recursive: true }).catch((error) => {
          logger.debug('[claude-terminal] Could not create the Claude project folder', error);
        });
      },
      follow: ({ session }) => followClaudeTitle({ session, transcriptPath, claudeSessionId: launch.claudeSessionId }),
    };
  },
};

/**
 * Claude Code's environment in a terminal: the user's own, plus what chat sessions get for the folder
 * (`resolveClaudeSessionEnvOverlay`): in a folder another computer shares here, no `git status` before
 * the first answer, which reads the whole repository over the connection and takes minutes.
 */
export function claudeNativeTerminalEnv(params: Readonly<{
  baseEnv: NodeJS.ProcessEnv;
  directory: string;
  inSharedFolder?: (path: string) => boolean;
}>): NodeJS.ProcessEnv {
  return prepareClaudeSubprocessEnv({
    baseEnv: params.baseEnv,
    envOverlay: resolveClaudeSessionEnvOverlay({
      cwd: params.directory,
      baseEnv: params.baseEnv,
      ...(params.inSharedFolder ? { inSharedFolder: params.inSharedFolder } : {}),
    }),
  });
}

/** Names the session after the title Claude gives the conversation (a `/rename` wins). */
export function followClaudeTitle(params: Readonly<{
  session: NativeTerminalSessionClient;
  transcriptPath: string;
  claudeSessionId: string;
}>): () => Promise<void> {
  const follower = createClaudeTranscriptTitleFollower(params.transcriptPath);
  let reading = false;
  let readAgain = false;
  // A title the relay did not take (it was away) is written again with Claude's next change.
  let unrecordedTitle: string | null = null;
  const read = async (): Promise<void> => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      do {
        readAgain = false;
        try {
          const title = (await follower.readChanges()) ?? unrecordedTitle;
          if (title) {
            unrecordedTitle = title;
            await params.session.updateMetadata((metadata) => applyProviderSessionInfoUpdate({
              metadata,
              provider: 'claude',
              sessionId: params.claudeSessionId,
              observedAt: Date.now(),
              update: { title },
              titlePolicy: 'follow',
            }));
            unrecordedTitle = null;
          }
        } catch (error) {
          // A change that came in meanwhile is still read below.
          logger.debug('[claude-terminal] Could not read or record the Claude title', error);
        }
      } while (readAgain);
    } finally {
      reading = false;
    }
  };
  return startFileWatcher(params.transcriptPath, () => {
    void read();
  });
}
