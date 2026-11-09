import { randomUUID } from 'node:crypto';

import { createSessionMetadata, type BackendFlavor } from '@/agent/runtime/createSessionMetadata';
import { createStartupMetadataOverrides } from '@/agent/runtime/createStartupMetadataOverrides';
import { initializeBackendApiContext } from '@/agent/runtime/initializeBackendApiContext';
import { initializeBackendRunSession } from '@/agent/runtime/initializeBackendRunSession';
import type { Metadata } from '@/api/types';
import { initialMachineMetadata } from '@/daemon/machine/metadata';
import { clearPendingFirstInputFromEnv, readPendingFirstInputFromEnv } from '@/daemon/spawn/pendingFirstInput';
import type { Credentials } from '@/persistence';
import type { TerminalRuntimeFlags } from '@/terminal/runtime/terminalRuntimeFlags';

import { runNativeTerminalSession, type NativeTerminalFollower } from './runNativeTerminalSession';

export type NativeTerminalLaunch = Readonly<{
  cli: Readonly<{ command: string; args: readonly string[] }>;
  env: NodeJS.ProcessEnv;
  /** What the session records from the start, such as the conversation it opens. */
  metadata: Readonly<Partial<Metadata>>;
  follow: NativeTerminalFollower;
  /** Runs once the session is registered, right before the CLI starts. */
  beforeStart?: () => Promise<void>;
}>;

/** What a CLI needs to run as a 「终端」 session. */
export type NativeTerminalProvider = Readonly<{
  flavor: BackendFlavor;
  /** The CLI's name in messages, e.g. "Claude Code". */
  name: string;
  logPrefix: string;
  planLaunch: (params: Readonly<{
    directory: string;
    /** The conversation to reopen, when the session has one. */
    resumeId: string | null;
    /** What the user typed when creating the session; the CLI gets it as its first prompt. */
    firstPrompt: string | null;
  }>) => NativeTerminalLaunch;
}>;

export type RunNativeTerminalOptions = Readonly<{
  provider: NativeTerminalProvider;
  credentials: Credentials;
  startedBy: 'daemon' | 'terminal';
  existingSessionId?: string;
  resumeId?: string;
  terminalRuntime: TerminalRuntimeFlags | null;
}>;

/**
 * Runs a 「终端」 session: the provider's own CLI in this terminal, as if typed into a shell.
 * PiggerCode adds no system prompt, MCP server, hooks or settings; it only registers the session
 * (so the app lists, shows and stops it) and follows the conversation's id and title.
 */
export async function runNativeTerminal(opts: RunNativeTerminalOptions): Promise<void> {
  // The daemon hands over the text typed in the new-session screen. A terminal types it into the
  // CLI, so take it before the session bootstrap would queue it as a chat message nobody reads.
  const firstPrompt = takeNativeTerminalFirstPrompt(process.env);
  const directory = process.cwd();
  const { api, machineId } = await initializeBackendApiContext({
    credentials: opts.credentials,
    machineMetadata: initialMachineMetadata,
  });
  const launch = opts.provider.planLaunch({
    directory,
    resumeId: opts.resumeId?.trim() || null,
    firstPrompt,
  });

  const { state, metadata } = createSessionMetadata({
    flavor: opts.provider.flavor,
    machineId,
    directory,
    startedBy: opts.startedBy,
    terminalRuntime: opts.terminalRuntime,
  });
  const { session } = await initializeBackendRunSession({
    api,
    sessionTag: randomUUID(),
    metadata: { ...metadata, ...launch.metadata, nativeTerminal: true },
    state,
    ...(opts.existingSessionId ? { existingSessionId: opts.existingSessionId } : {}),
    uiLogPrefix: opts.provider.logPrefix,
    startupMetadataOverrides: createStartupMetadataOverrides({}),
    // A chat session reopened as a terminal: its chat runtime record no longer describes it, and
    // it would name the conversation to resume ahead of the one the terminal writes.
    metadataKeysToUnsetOnAttach: ['agentRuntimeDescriptorV1'],
  });

  await launch.beforeStart?.();
  await runNativeTerminalSession({
    session,
    cli: launch.cli,
    cwd: directory,
    env: launch.env,
    follow: launch.follow,
    process,
    exit: (code) => process.exit(code),
    holdFailedExit: (exitCode) => holdFailedExitUntilEnter(opts.provider.name, exitCode),
    logPrefix: opts.provider.logPrefix,
  });
}

export function takeNativeTerminalFirstPrompt(env: NodeJS.ProcessEnv): string | null {
  const pending = readPendingFirstInputFromEnv(env);
  clearPendingFirstInputFromEnv(env);
  const text = pending?.text ?? '';
  return text.trim() ? text : null;
}

async function holdFailedExitUntilEnter(name: string, exitCode: number): Promise<void> {
  if (!process.stdin.isTTY) return;
  process.stdout.write(`\r\n${name} exited with code ${exitCode}. Press Enter to close this terminal.\r\n`);
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });
  process.stdin.pause();
}
