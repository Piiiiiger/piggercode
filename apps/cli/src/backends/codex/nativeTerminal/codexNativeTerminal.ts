import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { applyProviderSessionInfoUpdate } from '@/agent/acp/runtime/providerSessionInfoState';
import { readDirectSessionTitleCandidate } from '@/api/directSessions/title/readDirectSessionTitleCandidate';
import { readCodexSessionTitleFromRollout } from '@/backends/codex/directSessions/readCodexSessionTitleFromRollout';
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { PIGGERCODE_SPAWN_EXPLICIT_ENV_KEYS_JSON_ENV_VAR } from '@/daemon/spawn/spawnExplicitEnvKeysMarker';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import { createJsonlFileTail } from '@/terminal/nativeTerminal/jsonlFileTail';
import type { NativeTerminalProvider } from '@/terminal/nativeTerminal/runNativeTerminal';
import type { NativeTerminalSessionClient } from '@/terminal/nativeTerminal/runNativeTerminalSession';
import { logger } from '@/ui/logger';
import { stripNestedSessionDetectionEnv } from '@/utils/processEnv/stripNestedSessionDetectionEnv';

import { readCodexThreadsHeldByProcess, type HeldCodexThread } from './readCodexThreadsHeldByProcess';

/**
 * How often the session looks at what the terminal's `codex` writes. Reading /proc costs next to
 * nothing; on macOS each look runs pgrep and lsof (tens of milliseconds), about 1% of a core per
 * Codex terminal.
 */
const FOLLOW_INTERVAL_MS = 3_000;

/** Native Codex as a 「终端」 session: `codex`, or `codex resume <id>`, with nothing added. */
export const codexNativeTerminal: NativeTerminalProvider = {
  flavor: 'codex',
  name: 'Codex',
  logPrefix: '[codex-terminal]',
  planLaunch: ({ resumeId, firstPrompt }) => {
    const launch = planCodexNativeTerminalLaunch({ resumeThreadId: resumeId, firstPrompt });
    const codex = requireProviderCliLaunchSpec('codex', { processEnv: process.env });
    const env = stripNestedSessionDetectionEnv(process.env);
    delete env[PIGGERCODE_SPAWN_EXPLICIT_ENV_KEYS_JSON_ENV_VAR];
    const codexHome = resolveConfiguredCodexHome(env);
    return {
      cli: { command: codex.command, args: [...codex.args, ...launch.args] },
      env,
      metadata: launch.threadId ? { codexSessionId: launch.threadId } : {},
      follow: ({ session, childPid }) => followCodexThread({
        session,
        childPid,
        codexHome,
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
 * Records which conversation the terminal's `codex` writes (`codexSessionId`, so reopening resumes
 * it) and names the session after it: the name given in Codex, else its first message. Codex can
 * switch conversations in one terminal (`/new`, `/resume`), so this keeps looking while it runs.
 */
export function followCodexThread(params: Readonly<{
  session: NativeTerminalSessionClient;
  childPid: number | null;
  codexHome: string;
  /** The conversation the terminal reopened, already recorded on the session. */
  initialThreadId: string | null;
  readHeldThreads?: (pid: number) => Promise<readonly HeldCodexThread[]>;
  intervalMs?: number;
}>): () => Promise<void> {
  const { session, childPid } = params;
  if (childPid === null) return async () => undefined;
  const readHeldThreads = params.readHeldThreads ?? readCodexThreadsHeldByProcess;
  const threadNames = createCodexThreadNames(join(params.codexHome, 'session_index.jsonl'));
  // What the terminal writes, and what the session has recorded: a write that fails (the relay is
  // away) is tried again on the next look.
  let threadId = params.initialThreadId;
  let recordedThreadId = params.initialThreadId;
  let rolloutPath: string | null = null;
  let firstMessageTitle: string | null = null;
  let recordedTitle: string | null = null;

  const look = async (): Promise<void> => {
    const held = await readHeldThreads(childPid);
    const current = held.find((thread) => thread.threadId === threadId);
    if (current) {
      rolloutPath = current.rolloutPath ?? rolloutPath;
    } else if (held.length > 0) {
      // Codex writes another conversation now. Sub-agents write their own beside the main one,
      // which is the oldest: Codex thread ids start with their creation time.
      const next = [...held].sort((a, b) => a.threadId.localeCompare(b.threadId))[0]!;
      threadId = next.threadId;
      rolloutPath = next.rolloutPath;
      firstMessageTitle = null;
      recordedTitle = null;
    }
    if (!threadId) return;
    const lookedThreadId = threadId;
    if (lookedThreadId !== recordedThreadId) {
      await session.updateMetadata((metadata) => ({ ...metadata, codexSessionId: lookedThreadId }));
      recordedThreadId = lookedThreadId;
    }

    const named = await threadNames.read(lookedThreadId);
    if (!named && !firstMessageTitle && rolloutPath) {
      firstMessageTitle = await readCodexSessionTitleFromRollout(rolloutPath);
    }
    const title = named ?? firstMessageTitle;
    if (!title || title === recordedTitle) return;
    await session.updateMetadata((metadata) => applyProviderSessionInfoUpdate({
      metadata,
      provider: 'codex',
      sessionId: lookedThreadId,
      observedAt: Date.now(),
      update: { title },
      titlePolicy: 'follow',
    }));
    recordedTitle = title;
  };

  let stopped = false;
  let running: Promise<void> | null = null;
  let lookAgain = false;
  // One look at a time; a request during a look runs one more after it.
  const lookNow = (): Promise<void> => {
    if (running) {
      lookAgain = true;
      return running;
    }
    running = (async () => {
      do {
        lookAgain = false;
        await look().catch((error) => {
          logger.debug('[codex-terminal] Could not follow the Codex conversation', error);
        });
      } while (lookAgain && !stopped);
    })().finally(() => {
      running = null;
    });
    return running;
  };
  // Codex takes a conversation's writer lock when it starts writing it (a first message, `/new`,
  // `/resume`): look at once, so quitting right after does not leave the session on the old one.
  // Codex makes the lock folder with its first conversation, so until it exists every poll tries
  // to watch it again.
  const locksDir = join(params.codexHome, 'thread-writer-locks');
  let locksWatcher: FSWatcher | null = null;
  const watchLocks = () => {
    if (locksWatcher || stopped) return;
    try {
      const watcher = watch(locksDir, { persistent: false }, () => {
        if (!stopped) void lookNow();
      });
      watcher.on('error', () => {
        watcher.close();
        if (locksWatcher === watcher) locksWatcher = null;
      });
      locksWatcher = watcher;
    } catch {
      // Not there yet.
    }
  };
  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    timer = setTimeout(() => {
      watchLocks();
      void lookNow().then(() => {
        if (!stopped) schedule();
      });
    }, params.intervalMs ?? FOLLOW_INTERVAL_MS);
    timer.unref?.();
  };
  watchLocks();
  schedule();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    locksWatcher?.close();
    locksWatcher = null;
    await running;
  };
}

/** The names given to Codex conversations (`/rename`), from `session_index.jsonl`; the last one wins. */
function createCodexThreadNames(indexPath: string) {
  const tail = createJsonlFileTail(indexPath);
  const names = new Map<string, string>();
  return {
    read: async (threadId: string): Promise<string | null> => {
      await tail.readNew((value) => {
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        if (typeof record.id !== 'string' || typeof record.thread_name !== 'string') return;
        const name = readDirectSessionTitleCandidate(record.thread_name);
        if (name) names.set(record.id, name);
        else names.delete(record.id);
      });
      return names.get(threadId) ?? null;
    },
  };
}
