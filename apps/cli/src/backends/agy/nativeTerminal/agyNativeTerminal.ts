import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizePermissionModeForAgent } from '@piggercode/agents';

import { applyProviderSessionInfoUpdate } from '@/agent/acp/runtime/providerSessionInfoState';
import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import { createAgyAccountUsageReporter } from '@/backends/agy/accounts/agyAccountUsageReporter';
import {
  readAgyAccountUsageFromStatus,
  type AgyAccountUsageReading,
} from '@/backends/agy/accounts/readAgyAccountUsageFromStatus';
import type { PermissionMode } from '@/api/types';
import { notifyDaemonAgyAccountUsage } from '@/daemon/controlClient';
import { PIGGERCODE_SPAWN_EXPLICIT_ENV_KEYS_JSON_ENV_VAR } from '@/daemon/spawn/spawnExplicitEnvKeysMarker';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import type { NativeTerminalActivity } from '@/terminal/nativeTerminal/nativeTerminalActivityReporter';
import type { NativeTerminalControls, NativeTerminalProvider } from '@/terminal/nativeTerminal/runNativeTerminal';
import type { NativeTerminalSessionClient } from '@/terminal/nativeTerminal/runNativeTerminalSession';
import { logger } from '@/ui/logger';
import { stripNestedSessionDetectionEnv } from '@/utils/processEnv/stripNestedSessionDetectionEnv';
import { openSqliteDatabaseSync, type SqliteDatabaseSync, type SqliteStatementSync } from '@/utils/sqlite/sqliteSync';

/** The file the title command below keeps agy's state in, one per session. */
export const AGY_STATE_FILE_ENV_VAR = 'PIGGERCODE_AGY_STATE_FILE';

/**
 * agy runs its `title` command with `sh -c` whenever what it shows changes, with its state as JSON on
 * stdin (the status line payload: `conversation_id`, `conversation_title`, `agent_state`,
 * `tool_confirmation_pending`, `task_count`, …; agy 1.5.14), and sets the window title from what the
 * command prints. This one prints nothing, so the title stays, and replaces the session's state file
 * whole. `--settings` adds it for this session only, over the user's own settings, and never saves
 * it. `sh`, like the tmux every 「终端」 session runs in, makes this macOS and Linux only.
 */
export const AGY_STATE_TITLE_SETTING = {
  type: 'command',
  // Even when the user's own settings turn their title command off.
  enabled: true,
  command: `cat > "$${AGY_STATE_FILE_ENV_VAR}.tmp" && mv -f "$${AGY_STATE_FILE_ENV_VAR}.tmp" "$${AGY_STATE_FILE_ENV_VAR}"`,
};
const AGY_SESSION_SETTINGS = JSON.stringify({ title: AGY_STATE_TITLE_SETTING });

/** How often the state file is read: how late a notification can be, for one small read a second. */
const STATE_READ_INTERVAL_MS = 1_000;

/** The environment agy starts in, with the file its title command keeps its state in. */
export function agyLaunchEnv(statePath: string): NodeJS.ProcessEnv {
  const env = stripNestedSessionDetectionEnv(process.env);
  delete env[PIGGERCODE_SPAWN_EXPLICIT_ENV_KEYS_JSON_ENV_VAR];
  env[AGY_STATE_FILE_ENV_VAR] = statePath;
  return env;
}

/** Google's Antigravity CLI as a 「终端」 session: `agy`, or `agy --conversation <id>`. */
export const agyNativeTerminal: NativeTerminalProvider = {
  flavor: 'agy',
  name: 'Antigravity',
  logPrefix: '[agy-terminal]',
  planLaunch: ({ resumeId, firstPrompt, controls }) => {
    const launch = planAgyNativeTerminalLaunch({ resumeConversationId: resumeId, firstPrompt, controls });
    const agy = requireProviderCliLaunchSpec('agy', { processEnv: process.env });
    // Made right before agy starts, private to the user: the state names the account and the folder.
    const stateDir = join(tmpdir(), `piggercode-agy-${randomUUID()}`);
    const statePath = join(stateDir, 'state.json');
    const env = agyLaunchEnv(statePath);
    return {
      cli: { command: agy.command, args: [...agy.args, ...launch.args] },
      env,
      metadata: launch.conversationId ? { agySessionId: launch.conversationId } : {},
      beforeStart: async () => {
        await mkdir(stateDir, { mode: 0o700 });
      },
      follow: ({ session, reportActivity }) => {
        const stop = followAgyConversation({
          session,
          statePath,
          conversationIndexPath: agyConversationIndexPath(),
          initialConversationId: launch.conversationId,
          reportActivity,
          reportAccountUsage: createAgyAccountUsageReporter({ send: notifyDaemonAgyAccountUsage }),
        });
        return async () => {
          await stop();
          await rm(stateDir, { recursive: true, force: true });
        };
      },
    };
  },
};

export function planAgyNativeTerminalLaunch(params: Readonly<{
  resumeConversationId: string | null;
  /**
   * Typed in the new-session screen, sent as the first prompt of the new or reopened conversation; a flag's
   * `=` value, so text that starts with a dash stays text.
   */
  firstPrompt: string | null;
  controls: NativeTerminalControls;
}>): Readonly<{ conversationId: string | null; args: string[] }> {
  const rawModelId = params.controls.modelId?.trim() ?? '';
  const modelId = rawModelId && rawModelId !== 'default' ? rawModelId : '';
  const resume = params.resumeConversationId?.trim() ?? '';
  // agy 1.5.14 takes `--conversation` and `--prompt-interactive` together; a conversation it cannot find
  // gets a warning and a new conversation with the prompt.
  const args = [
    `--settings=${AGY_SESSION_SETTINGS}`,
    ...(modelId ? [`--model=${modelId}`] : []),
    ...agyPermissionArgs(params.controls.permissionMode ?? 'default'),
    ...(resume ? [`--conversation=${resume}`] : []),
    ...(params.firstPrompt ? [`--prompt-interactive=${params.firstPrompt}`] : []),
  ];
  return { conversationId: resume || null, args };
}

/**
 * The new-session screen's permission choice as agy's execution mode (agy 1.5.14): `default` leaves the
 * user's own agy setting in charge; read-only plans first (`plan`); safe-yolo approves workspace edits
 * and safe commands (`auto`, which agy turns into its default mode where it is not available); yolo
 * approves every tool.
 */
function agyPermissionArgs(mode: PermissionMode): string[] {
  switch (normalizePermissionModeForAgent({ agentId: 'agy', mode })) {
    case 'read-only':
    case 'plan':
      return ['--mode=plan'];
    case 'safe-yolo':
      return ['--mode=auto'];
    case 'yolo':
      return ['--dangerously-skip-permissions'];
    default:
      return [];
  }
}

const AGY_WORKING_STATES = new Set(['working', 'tool_use']);

/**
 * What agy's state says it shows; null for a state this cannot read or does not know (starting up,
 * signing in, an error, and `reviewing`, whose meaning agy does not document).
 */
export function readAgyActivity(state: unknown): NativeTerminalActivity | null {
  if (!state || typeof state !== 'object') return null;
  const { agent_state: agentState, tool_confirmation_pending: confirmationPending, task_count: taskCount } =
    state as { agent_state?: unknown; tool_confirmation_pending?: unknown; task_count?: unknown };
  if (confirmationPending === true) return { kind: 'waiting', on: 'permission' };
  if (typeof agentState === 'string' && AGY_WORKING_STATES.has(agentState)) return { kind: 'working' };
  if (agentState !== 'idle') return null;
  return typeof taskCount === 'number' && taskCount > 0 ? { kind: 'idle', background: true } : { kind: 'idle' };
}

/**
 * agy's own index of its conversations. The title agy gives a conversation lives only here: its state's
 * `conversation_title` carries a title the user set (`/rename`, which also lands here) and nothing else
 * (agy 1.5.14).
 */
export function agyConversationIndexPath(homeDir: string = homedir()): string {
  return join(homeDir, '.gemini', 'antigravity-cli', 'conversation_summaries.db');
}

/**
 * Reads conversation titles from agy's index, read-only (agy writes it in WAL mode, so reading never holds
 * agy up). Null while a conversation has no title, and while the index cannot be read (not there yet, or an
 * agy that keeps it differently), which is logged once per distinct error.
 */
function createAgyConversationTitleReader(indexPath: string): Readonly<{
  read: (conversationId: string) => string | null;
  close: () => void;
}> {
  let database: SqliteDatabaseSync | null = null;
  let statement: SqliteStatementSync | null = null;
  let lastError: string | null = null;
  const close = (): void => {
    try {
      database?.close();
    } catch {
      // Closing a handle that failed is nothing to report.
    }
    database = null;
    statement = null;
  };
  return {
    read: (conversationId) => {
      try {
        database ??= openSqliteDatabaseSync(indexPath, { readOnly: true });
        statement ??= database.prepare('SELECT title FROM conversation_summaries WHERE conversation_id = ?');
        const row = statement.get(conversationId);
        lastError = null;
        const title = row && typeof row === 'object' ? (row as { title?: unknown }).title : null;
        return typeof title === 'string' && title.trim() ? title.trim() : null;
      } catch (error) {
        close();
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) {
          lastError = message;
          logger.infoFile('[agy-terminal] Could not read conversation titles from the agy index', { indexPath, message });
        }
        return null;
      }
    },
    close,
  };
}

/**
 * Records which conversation the terminal's agy shows (`agySessionId`, so reopening resumes it), names
 * the session after it, and reports what agy shows, all from the state its title command keeps (one
 * file per session, so two terminals in one folder never take each other's conversation). Conversation
 * switches inside the terminal (`/clear`, `/resume`) and renames come through the same state. Returns how
 * to stop; stopping reads the state once more, so a switch in agy's last second is still recorded.
 */
export function followAgyConversation(params: Readonly<{
  session: NativeTerminalSessionClient;
  statePath: string;
  /** agy's conversation index, where the titles it gives conversations live (`agyConversationIndexPath`). */
  conversationIndexPath: string;
  /** The conversation the terminal reopened, already recorded on the session. */
  initialConversationId: string | null;
  reportActivity?: (activity: NativeTerminalActivity) => void;
  /** Gets the account's limits each time agy writes them. */
  reportAccountUsage?: (reading: AgyAccountUsageReading) => void;
  /** Reads the state file (the file system; replaced in tests). */
  readState?: (path: string) => Promise<string>;
  intervalMs?: number;
}>): () => Promise<void> {
  const { session } = params;
  const readState = params.readState ?? ((path: string) => readFile(path, 'utf8'));
  const titles = createAgyConversationTitleReader(params.conversationIndexPath);
  // From agy's newest whole state: its conversation and a title the user set there.
  let stateConversationId: string | null = null;
  let stateTitle: string | null = null;
  // What agy shows, and what the session has recorded. Writes run beside the reads, one at a time, so a
  // slow relay never holds up what agy shows; a write the relay rejected is tried again after the next read.
  let shown: Readonly<{ conversationId: string; title: string | null }> | null = null;
  let recordedConversationId = params.initialConversationId;
  let recordedTitle: string | null = null;
  let writing: Promise<void> | null = null;
  let lastRaw: string | null = null;
  let unknownReported = false;
  const reportUnknown = (): void => {
    if (unknownReported) return;
    unknownReported = true;
    params.reportActivity?.({ kind: 'unknown' });
  };

  const write = async (target: NonNullable<typeof shown>): Promise<void> => {
    if (target.conversationId !== recordedConversationId) {
      await session.updateMetadata((metadata) => ({ ...metadata, agySessionId: target.conversationId }));
      recordedConversationId = target.conversationId;
      recordedTitle = null;
    }
    const title = target.title;
    if (title && title !== recordedTitle) {
      await session.updateMetadata((metadata) => applyProviderSessionInfoUpdate({
        metadata,
        provider: 'agy',
        sessionId: target.conversationId,
        observedAt: Date.now(),
        update: { title },
        titlePolicy: 'follow',
      }));
      recordedTitle = title;
    }
  };
  const unrecorded = (): NonNullable<typeof shown> | null => {
    const target = shown;
    if (!target) return null;
    if (target.conversationId === recordedConversationId && (!target.title || target.title === recordedTitle)) return null;
    return target;
  };
  const recordShown = (): void => {
    const target = unrecorded();
    if (writing || !target) return;
    writing = write(target)
      .catch((error) => {
        logger.debug('[agy-terminal] Could not record the agy conversation', error);
      })
      .finally(() => {
        writing = null;
      });
  };

  /** `report`: tell what agy shows; `record`: start writing what changed. */
  const read = async ({ report, record }: Readonly<{ report: boolean; record: boolean }>): Promise<void> => {
    let raw: string;
    try {
      raw = await readState(params.statePath);
    } catch (error) {
      // agy writes it once it shows its first screen.
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.infoFile('[agy-terminal] Could not read the agy state', serializeAxiosErrorForLog(error));
      }
      lastRaw = null;
      if (report) reportUnknown();
      return;
    }
    if (raw !== lastRaw) {
      let state: unknown;
      try {
        state = JSON.parse(raw);
      } catch {
        // Not a whole state (agy replaces the file, so this is another program's or a broken write).
        lastRaw = null;
        if (report) reportUnknown();
        return;
      }
      lastRaw = raw;
      const accountUsage = readAgyAccountUsageFromStatus(state);
      if (accountUsage) params.reportAccountUsage?.(accountUsage);
      const activity = readAgyActivity(state);
      if (report && activity) {
        unknownReported = false;
        params.reportActivity?.(activity);
      } else if (report) {
        reportUnknown();
      }
      const fields = state && typeof state === 'object' ? state as Record<string, unknown> : {};
      // Empty only while agy signs in: it opens a conversation as it starts, before any prompt.
      const conversationId = typeof fields.conversation_id === 'string' ? fields.conversation_id.trim() : '';
      if (conversationId) {
        stateConversationId = conversationId;
        const title = typeof fields.conversation_title === 'string' ? fields.conversation_title.trim() : '';
        stateTitle = title || null;
      }
    }
    if (stateConversationId) {
      // agy names a conversation some seconds after its first turn, with no state change to tell: ask its
      // index at every read.
      shown = { conversationId: stateConversationId, title: titles.read(stateConversationId) ?? stateTitle };
    }
    if (record) recordShown();
  };

  let stopped = false;
  let running: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const schedule = (delayMs: number) => {
    timer = setTimeout(() => {
      running = read({ report: true, record: true })
        .catch((error) => {
          logger.debug('[agy-terminal] Could not follow the agy conversation', error);
        })
        .finally(() => {
          running = null;
          if (!stopped) schedule(params.intervalMs ?? STATE_READ_INTERVAL_MS);
        });
    }, delayMs);
    timer.unref?.();
  };
  schedule(0);

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
    // agy has quit (or is being stopped): what it showed last is recorded, after any older write ends, with
    // one more try if the relay rejects it; what it shows is no longer reported.
    await read({ report: false, record: false }).catch((error) => {
      logger.debug('[agy-terminal] Could not read the last agy state', error);
    });
    await writing;
    for (let tries = 0; tries < 2 && unrecorded(); tries += 1) {
      recordShown();
      await writing;
    }
    titles.close();
  };
}
