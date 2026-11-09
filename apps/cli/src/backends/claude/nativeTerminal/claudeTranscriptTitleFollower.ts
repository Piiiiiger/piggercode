import { readJsonlFileForward } from '@/api/directSessions/filePaging/jsonlForwardReader';
import { JsonlRecordTooLargeError } from '@/api/directSessions/filePaging/jsonlReadBudget';
import { readClaudeTitleRecord } from '@/backends/claude/directSessions/readClaudeSessionTitle';

const READ_PAGE_MAX_BYTES = 256 * 1024;

export type ClaudeTranscriptTitleFollower = Readonly<{
  /** Reads what Claude appended since the last call; resolves to the current title when it changed. */
  readChanges: () => Promise<string | null>;
}>;

/**
 * Follows the title of one Claude transcript as Claude appends to it (`/rename` beats Claude's own
 * name, as in `readClaudeSessionTitle`). It reads only the new bytes on each call, so a long
 * transcript is not read again on every append.
 */
export function createClaudeTranscriptTitleFollower(transcriptPath: string): ClaudeTranscriptTitleFollower {
  let offsetBytes = 0;
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let published: string | null = null;

  const readChanges = async (): Promise<string | null> => {
    for (;;) {
      let page: Awaited<ReturnType<typeof readJsonlFileForward>>;
      try {
        page = await readJsonlFileForward({
          filePath: transcriptPath,
          offsetBytes,
          maxBytes: READ_PAGE_MAX_BYTES,
          maxItems: READ_PAGE_MAX_BYTES,
        });
      } catch (error) {
        if (!(error instanceof JsonlRecordTooLargeError)) throw error;
        // A record too big to read (a large tool result) never holds a title: step into it, and
        // its unreadable rest is dropped like any line that is not JSON.
        offsetBytes = error.offsetBytes + error.maxLineBytes;
        continue;
      }
      for (const item of page.items) {
        const titleRecord = readClaudeTitleRecord(item.value);
        if (titleRecord?.kind === 'custom') customTitle = titleRecord.title;
        if (titleRecord?.kind === 'ai') aiTitle = titleRecord.title;
      }
      const advanced = page.nextOffsetBytes > offsetBytes;
      // A shorter file is a rewritten one: start over from its beginning.
      offsetBytes = page.truncated && page.nextOffsetBytes === 0 ? 0 : page.nextOffsetBytes;
      if (page.reachedEnd || !advanced) break;
    }
    const title = customTitle ?? aiTitle;
    if (!title || title === published) return null;
    published = title;
    return title;
  };

  return { readChanges };
}
