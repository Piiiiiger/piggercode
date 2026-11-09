import { basename, join } from 'node:path';

import { applyProviderSessionInfoUpdate } from '@/agent/acp/runtime/providerSessionInfoState';
import { collectCodexSessionRolloutFiles } from '@/backends/codex/directSessions/collectCodexSessionRolloutFiles';
import { readCodexSessionMetaFromRollout } from '@/backends/codex/localControl/rolloutDiscovery';
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { PIGGERCODE_SPAWN_EXPLICIT_ENV_KEYS_JSON_ENV_VAR } from '@/daemon/spawn/spawnExplicitEnvKeysMarker';
import { TmuxUtilities } from '@/integrations/tmux';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import { createJsonlFileTail } from '@/terminal/nativeTerminal/jsonlFileTail';
import type { NativeTerminalProvider } from '@/terminal/nativeTerminal/runNativeTerminal';
import type { NativeTerminalSessionClient } from '@/terminal/nativeTerminal/runNativeTerminalSession';
import { logger } from '@/ui/logger';
import { stripNestedSessionDetectionEnv } from '@/utils/processEnv/stripNestedSessionDetectionEnv';

/** How often the session reads the terminal's window title (one tmux call). */
const FOLLOW_INTERVAL_MS = 3_000;

/** Native Codex as a 「终端」 session: `codex`, or `codex resume <id>`, with nothing added. */
export const codexNativeTerminal: NativeTerminalProvider = {
  flavor: 'codex',
  name: 'Codex',
  logPrefix: '[codex-terminal]',
  planLaunch: ({ directory, resumeId, firstPrompt }) => {
    const launch = planCodexNativeTerminalLaunch({ resumeThreadId: resumeId, firstPrompt });
    const codex = requireProviderCliLaunchSpec('codex', { processEnv: process.env });
    const env = stripNestedSessionDetectionEnv(process.env);
    delete env[PIGGERCODE_SPAWN_EXPLICIT_ENV_KEYS_JSON_ENV_VAR];
    const codexHome = resolveConfiguredCodexHome(env);
    return {
      cli: { command: codex.command, args: [...codex.args, ...launch.args] },
      env,
      metadata: launch.threadId ? { codexSessionId: launch.threadId } : {},
      follow: ({ session }) => followCodexThread({
        session,
        codexHome,
        directory,
        initialThreadId: launch.threadId,
      }),
    };
  },
};

export function planCodexNativeTerminalLaunch(params: Readonly<{
  resumeThreadId: string | null;
  /** Typed in the new-session screen; after `--` so text that starts with a dash stays text. */
  firstPrompt: string | null;
}>): Readonly<{ threadId: string | null; args: string[] }> {
  const resume = params.resumeThreadId?.trim() ?? '';
  if (resume) return { threadId: resume, args: ['resume', resume] };
  return { threadId: null, args: params.firstPrompt ? ['--', params.firstPrompt] : [] };
}

/**
 * Records which conversation the terminal's `codex` shows (`codexSessionId`, so reopening resumes
 * it) and names the session after it. One shared Codex service writes every terminal's
 * conversations, so nothing on disk says which one is this terminal's. Codex does show it in the
 * window title (`<conversation title> | <folder>`, only the folder until it names a new one): the
 * title is looked up in Codex's index (`session_index.jsonl`) among the conversations started in
 * this folder. This follows `/new`, `/resume` and renames. A name alone cannot tell two conversations
 * of the same name apart: the terminal keeps the one it follows while its name still shows (so two
 * terminals never take each other's), and a name new to it goes to the one Codex wrote last, the one
 * just named. Switching within one terminal to another conversation of the very same name keeps the
 * first one recorded.
 */
export function followCodexThread(params: Readonly<{
  session: NativeTerminalSessionClient;
  codexHome: string;
  /** The session's folder, where Codex runs. */
  directory: string;
  /** The conversation the terminal reopened, already recorded on the session. */
  initialThreadId: string | null;
  readWindowTitle?: () => Promise<string | null>;
  intervalMs?: number;
}>): () => Promise<void> {
  const { session } = params;
  const readWindowTitle = params.readWindowTitle ?? readTmuxPaneTitle;
  const threads = createCodexThreadIndex(params.codexHome);
  const folderName = basename(params.directory);
  // What the terminal shows, and what the session has recorded: a write the relay rejected (it was
  // away) is tried again on the next look.
  let threadId = params.initialThreadId;
  let recordedThreadId = params.initialThreadId;
  let recordedTitle: string | null = null;

  const look = async (): Promise<void> => {
    const title = readCodexConversationTitle(await readWindowTitle(), folderName);
    if (!title) return;
    const shownThreadId = await threads.find({ title, directory: params.directory, current: threadId });
    if (!shownThreadId) return;
    if (shownThreadId !== threadId) recordedTitle = null;
    threadId = shownThreadId;
    if (shownThreadId !== recordedThreadId) {
      await session.updateMetadata((metadata) => ({ ...metadata, codexSessionId: shownThreadId }));
      recordedThreadId = shownThreadId;
    }
    if (title === recordedTitle) return;
    await session.updateMetadata((metadata) => applyProviderSessionInfoUpdate({
      metadata,
      provider: 'codex',
      sessionId: shownThreadId,
      observedAt: Date.now(),
      update: { title },
      titlePolicy: 'follow',
    }));
    recordedTitle = title;
  };

  let stopped = false;
  let running: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    timer = setTimeout(() => {
      running = look()
        .catch((error) => {
          logger.debug('[codex-terminal] Could not follow the Codex conversation', error);
        })
        .finally(() => {
          running = null;
          if (!stopped) schedule();
        });
    }, params.intervalMs ?? FOLLOW_INTERVAL_MS);
    timer.unref?.();
  };
  schedule();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}

/** The conversation title in Codex's window title (`<title> | <folder>`); none while it has none. */
export function readCodexConversationTitle(windowTitle: string | null, folderName: string): string | null {
  const suffix = ` | ${folderName}`;
  if (!windowTitle || !folderName || !windowTitle.endsWith(suffix)) return null;
  return windowTitle.slice(0, -suffix.length).trim() || null;
}

/** The title Codex gave this terminal's window (tmux keeps it as the pane title). */
async function readTmuxPaneTitle(): Promise<string | null> {
  const pane = process.env.TMUX_PANE;
  if (!pane || !process.env.TMUX) return null;
  const result = await new TmuxUtilities().executeTmuxCommand(['display-message', '-p', '-t', pane, '#{pane_title}']);
  return result?.returncode === 0 ? result.stdout.replace(/\r?\n$/, '') : null;
}

/** Codex's conversation names (`session_index.jsonl`, the last line for an id wins) and folders. */
function createCodexThreadIndex(codexHome: string) {
  const tail = createJsonlFileTail(join(codexHome, 'session_index.jsonl'));
  const names = new Map<string, string>();
  const folders = new Map<string, string>();

  const folderOf = async (threadId: string): Promise<string | null> => {
    const known = folders.get(threadId);
    if (known) return known;
    for (const rollout of await collectCodexSessionRolloutFiles({ codexHome, remoteSessionId: threadId })) {
      const cwd = (await readCodexSessionMetaFromRollout(rollout.filePath))?.cwd;
      if (typeof cwd === 'string' && cwd.trim()) {
        // A conversation's folder never changes; one not found yet is looked up again.
        folders.set(threadId, cwd.trim());
        return cwd.trim();
      }
    }
    return null;
  };
  const lastWrittenAt = async (threadId: string): Promise<number> => {
    const rollouts = await collectCodexSessionRolloutFiles({ codexHome, remoteSessionId: threadId });
    return Math.max(0, ...rollouts.map((rollout) => rollout.mtimeMs));
  };

  return {
    find: async (params: Readonly<{ title: string; directory: string; current: string | null }>): Promise<string | null> => {
      await tail.readNew((value) => {
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        if (typeof record.id !== 'string' || typeof record.thread_name !== 'string') return;
        names.set(record.id, record.thread_name.trim());
      });
      const inFolder: string[] = [];
      for (const [candidate, name] of names) {
        if (name === params.title && sameFolder(await folderOf(candidate), params.directory)) inFolder.push(candidate);
      }
      if (params.current && inFolder.includes(params.current)) return params.current;
      if (inFolder.length <= 1) return inFolder[0] ?? null;
      const written = await Promise.all(inFolder.map(async (candidate) => ({ candidate, at: await lastWrittenAt(candidate) })));
      return written.sort((a, b) => b.at - a.at)[0]!.candidate;
    },
  };
}

function sameFolder(a: string | null, b: string): boolean {
  if (!a) return false;
  const trim = (path: string) => path.replace(/[\\/]+$/, '') || path;
  return trim(a) === trim(b);
}
