import { stat } from 'node:fs/promises';

import { readJsonlFileBackwardPage } from '@/api/directSessions/filePaging/jsonlBackwardPager';
import { logger } from '@/ui/logger';

/** The model and thinking level a Claude conversation last answered with. */
export type ClaudeReplyChoices = Readonly<{ modelId: string; effort: string | null }>;

const PAGE_MAX_BYTES = 256 * 1024;
// JSON.stringify writes the record type verbatim, so a line without it cannot be a reply. Checking raw
// bytes first skips JSON.parse for nearly every transcript line; the record is still checked after parsing.
const REPLY_RECORD_MARKER = Buffer.from('"type":"assistant"');

/**
 * What one transcript record says the conversation answered with: a reply of the conversation itself
 * (not a subagent's) names the model claude asked for and, since Claude Code 2.1.x, its thinking level.
 * Claude's own notices (an API error) are replies "from" `<synthetic>` and say nothing about the choice.
 */
function readReplyChoices(value: unknown): ClaudeReplyChoices | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'assistant' || record.isSidechain === true) return null;
  const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : null;
  const modelId = [record.requestedModel, message?.model].find(isModelId);
  if (!modelId) return null;
  return { modelId, effort: typeof record.effort === 'string' && record.effort ? record.effort : null };
}

/** 0 for a conversation without a transcript yet (Claude writes it with the first message). */
async function transcriptSize(transcriptPath: string): Promise<number> {
  try {
    return (await stat(transcriptPath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    throw error;
  }
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !value.startsWith('<');
}

/**
 * The model and thinking level of the last reply in a Claude transcript, read from its end; null when it
 * has no reply or cannot be read (claude then takes the ones in its settings files, as it always did).
 */
export async function readClaudeLastReplyChoices(transcriptPath: string): Promise<ClaudeReplyChoices | null> {
  try {
    let endOffsetBytes = await transcriptSize(transcriptPath);
    while (endOffsetBytes > 0) {
      const page = await readJsonlFileBackwardPage({
        filePath: transcriptPath,
        endOffsetBytes,
        maxBytes: PAGE_MAX_BYTES,
        // The byte page bounds memory; every record takes at least one byte.
        maxItems: PAGE_MAX_BYTES,
        lineFilter: (line) => line.includes(REPLY_RECORD_MARKER),
      });
      for (let index = page.items.length - 1; index >= 0; index -= 1) {
        const choices = readReplyChoices(page.items[index]?.value);
        if (choices) return choices;
      }
      if (page.reachedStart || page.nextEndOffsetBytes >= endOffsetBytes) break;
      endOffsetBytes = page.nextEndOffsetBytes;
    }
  } catch (error) {
    // A record too big to read whole, or a file that cannot be read: claude takes its own settings.
    logger.infoFile('[claude-terminal] Could not read the model and thinking level the conversation last used', error);
  }
  return null;
}
