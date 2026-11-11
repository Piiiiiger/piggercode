import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import type { NativeTerminalActivity } from '@/terminal/nativeTerminal/nativeTerminalActivityReporter';
import { logger } from '@/ui/logger';

/**
 * Claude Code's own record of what one of its processes shows: `<config dir>/sessions/<pid>.json`,
 * rewritten on every change (Claude Code 2.1.322). `status` is `busy`, `idle` or `waiting`; a wait
 * names what it waits for (`waitingFor`): "input needed" is a question, "dialog open" is a dialog the
 * user opened (such as `/config`), anything else ("permission prompt", "sandbox request", …) is an
 * approval.
 */
export function claudeSessionStatusPath(claudeConfigDir: string, claudePid: number): string {
  return join(claudeConfigDir, 'sessions', `${claudePid}.json`);
}

/** What the record says Claude shows; null for a record this cannot read, or a dialog the user opened. */
export function readClaudeSessionActivity(record: unknown): NativeTerminalActivity | null {
  if (!record || typeof record !== 'object') return null;
  const { status, waitingFor } = record as { status?: unknown; waitingFor?: unknown };
  if (status === 'busy') return { kind: 'working' };
  if (status === 'idle') return { kind: 'idle' };
  if (status !== 'waiting') return null;
  if (waitingFor === 'dialog open') return null;
  return { kind: 'waiting', on: waitingFor === 'input needed' ? 'question' : 'permission' };
}

/**
 * How often the record is read. It sets how late a notification can be; one read of a small file a
 * second costs nothing, and works whether Claude rewrites the file in place or replaces it.
 */
const STATUS_READ_INTERVAL_MS = 1_000;

/** Reports what Claude shows each time its record changes. Returns how to stop. */
export function followClaudeSessionStatus(params: Readonly<{
  statusPath: string;
  reportActivity: (activity: NativeTerminalActivity) => void;
  intervalMs?: number;
}>): () => Promise<void> {
  let lastRaw: string | null = null;
  const read = async (): Promise<void> => {
    let raw: string;
    try {
      raw = await readFile(params.statusPath, 'utf8');
    } catch (error) {
      // Claude writes it once it has started, and removes it when it quits.
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.infoFile('[claude-terminal] Could not read the Claude status', serializeAxiosErrorForLog(error));
      }
      return;
    }
    if (raw === lastRaw) return;
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch {
      // A rewrite in progress; the next read sees it whole.
      return;
    }
    lastRaw = raw;
    const activity = readClaudeSessionActivity(record);
    if (activity) params.reportActivity(activity);
  };

  let stopped = false;
  let running: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const schedule = (delayMs: number) => {
    timer = setTimeout(() => {
      running = read().finally(() => {
        running = null;
        if (!stopped) schedule(params.intervalMs ?? STATUS_READ_INTERVAL_MS);
      });
    }, delayMs);
    timer.unref?.();
  };
  schedule(0);

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}
