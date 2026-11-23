import type { AgyAccountUsageReportV1 } from '@piggercode/protocol';

import { logger } from '@/ui/logger';

import type { AgyAccountUsageReading } from './readAgyAccountUsageFromStatus';

/** While the numbers stand still, how often "last seen" moves on. */
const UNCHANGED_REPORT_INTERVAL_MS = 60_000;

/**
 * Hands the daemon what a session sees: at once when it changes, and once a minute while agy keeps rewriting
 * the same numbers, so "last seen" stays true. One request at a time; a newer reading replaces one waiting.
 * Nothing waits for it: a session's stop must not depend on the daemon answering.
 */
export function createAgyAccountUsageReporter(params: Readonly<{
  send: (report: AgyAccountUsageReportV1) => Promise<Readonly<{ error?: string }> | null | undefined>;
  now?: () => number;
}>): (reading: AgyAccountUsageReading) => void {
  const now = params.now ?? Date.now;
  let lastNumbers: string | null = null;
  let lastReportedAt = 0;
  let waiting: AgyAccountUsageReportV1 | null = null;
  let sending = false;

  const sendWaiting = async (): Promise<void> => {
    sending = true;
    while (waiting) {
      const report = waiting;
      waiting = null;
      const result = await params.send(report).catch((error: unknown) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
      if (result?.error) {
        logger.infoFile('[agy-accounts] The daemon did not take the usage reading', result.error);
        // Not delivered: the next write of the same numbers goes out at once.
        lastNumbers = null;
      }
    }
    sending = false;
  };

  return (reading) => {
    const numbers = JSON.stringify(reading);
    const at = now();
    if (numbers === lastNumbers && at - lastReportedAt < UNCHANGED_REPORT_INTERVAL_MS) return;
    lastNumbers = numbers;
    lastReportedAt = at;
    waiting = { ...reading, meters: [...reading.meters], observedAtMs: at };
    if (!sending) void sendWaiting();
  };
}
