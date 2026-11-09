import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createSessionMetadata } from '@/agent/runtime/createSessionMetadata';
import { createStartupMetadataOverrides } from '@/agent/runtime/createStartupMetadataOverrides';
import { initializeBackendApiContext } from '@/agent/runtime/initializeBackendApiContext';
import { initializeBackendRunSession } from '@/agent/runtime/initializeBackendRunSession';
import { prepareClaudeSubprocessEnv } from '@/backends/claude/spawn/buildClaudeSubprocessEnv';
import { getProjectPath } from '@/backends/claude/utils/path';
import { initialMachineMetadata } from '@/daemon/machine/metadata';
import type { Credentials } from '@/persistence';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import type { TerminalRuntimeFlags } from '@/terminal/runtime/terminalRuntimeFlags';
import { logger } from '@/ui/logger';

import { planClaudeNativeTerminalLaunch } from './claudeNativeTerminalLaunch';
import { runClaudeNativeTerminalSession } from './runClaudeNativeTerminalSession';

export type RunClaudeNativeTerminalOptions = Readonly<{
  credentials: Credentials;
  startedBy: 'daemon' | 'terminal';
  existingSessionId?: string;
  /** The Claude conversation to reopen (the daemon passes the session's `claudeSessionId`). */
  resumeClaudeSessionId?: string;
  terminalRuntime: TerminalRuntimeFlags | null;
}>;

/**
 * Runs a 「终端」 session: native Claude Code in this terminal, as if typed into a shell. PiggerCode adds
 * no system prompt, MCP server, hooks or settings; it only registers the session (so the app lists,
 * shows and stops it) and names it after the title Claude gives the conversation.
 */
export async function runClaudeNativeTerminal(opts: RunClaudeNativeTerminalOptions): Promise<void> {
  const directory = process.cwd();
  const { api, machineId } = await initializeBackendApiContext({
    credentials: opts.credentials,
    machineMetadata: initialMachineMetadata,
  });
  const projectDir = getProjectPath(directory);
  const launch = planClaudeNativeTerminalLaunch({
    resumeClaudeSessionId: opts.resumeClaudeSessionId ?? null,
    transcriptExists: (claudeSessionId) => existsSync(join(projectDir, `${claudeSessionId}.jsonl`)),
    newClaudeSessionId: randomUUID,
  });
  const claude = requireProviderCliLaunchSpec('claude', { processEnv: process.env });

  const { state, metadata } = createSessionMetadata({
    flavor: 'claude',
    machineId,
    directory,
    startedBy: opts.startedBy,
    terminalRuntime: opts.terminalRuntime,
  });
  const { session } = await initializeBackendRunSession({
    api,
    sessionTag: randomUUID(),
    metadata: { ...metadata, nativeTerminal: true, claudeSessionId: launch.claudeSessionId },
    state,
    ...(opts.existingSessionId ? { existingSessionId: opts.existingSessionId } : {}),
    uiLogPrefix: '[claude-terminal]',
    startupMetadataOverrides: createStartupMetadataOverrides({}),
  });

  // Claude creates this folder with the first message; the title watcher needs it to exist before.
  await mkdir(projectDir, { recursive: true }).catch((error) => {
    logger.debug('[claude-terminal] Could not create the Claude project folder', error);
  });
  await runClaudeNativeTerminalSession({
    session,
    claude: { command: claude.command, args: [...claude.args, ...launch.args] },
    claudeSessionId: launch.claudeSessionId,
    cwd: directory,
    env: prepareClaudeSubprocessEnv({ baseEnv: process.env }),
    transcriptPath: join(projectDir, `${launch.claudeSessionId}.jsonl`),
    process,
    exit: (code) => process.exit(code),
    holdFailedExit: holdFailedExitUntilEnter,
  });
}

async function holdFailedExitUntilEnter(exitCode: number): Promise<void> {
  if (!process.stdin.isTTY) return;
  process.stdout.write(`\r\nClaude Code exited with code ${exitCode}. Press Enter to close this terminal.\r\n`);
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
  process.stdin.pause();
}
