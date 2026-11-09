import { readJsonlFileForward } from '@/api/directSessions/filePaging/jsonlForwardReader';
import { JsonlRecordTooLargeError } from '@/api/directSessions/filePaging/jsonlReadBudget';

const READ_PAGE_MAX_BYTES = 256 * 1024;

export type JsonlFileTail = Readonly<{
  /** Hands over every record appended since the last call; a file that does not exist yet has none. */
  readNew: (onRecord: (value: unknown) => void) => Promise<void>;
}>;

/**
 * Follows a JSONL file a CLI appends to, reading only the new bytes on each call. A line the CLI is
 * still writing waits for the next call; a shorter file is a rewritten one and is read again from
 * its start.
 */
export function createJsonlFileTail(filePath: string): JsonlFileTail {
  let offsetBytes = 0;
  return {
    readNew: async (onRecord) => {
      for (;;) {
        let page: Awaited<ReturnType<typeof readJsonlFileForward>>;
        try {
          page = await readJsonlFileForward({
            filePath,
            offsetBytes,
            maxBytes: READ_PAGE_MAX_BYTES,
            maxItems: READ_PAGE_MAX_BYTES,
          });
        } catch (error) {
          if (!(error instanceof JsonlRecordTooLargeError)) throw error;
          // A record too big to read (a large tool result) is stepped into, and its unreadable
          // rest is dropped like any line that is not JSON.
          offsetBytes = error.offsetBytes + error.maxLineBytes;
          continue;
        }
        for (const item of page.items) onRecord(item.value);
        const advanced = page.nextOffsetBytes > offsetBytes;
        offsetBytes = page.truncated && page.nextOffsetBytes === 0 ? 0 : page.nextOffsetBytes;
        if (page.reachedEnd || !advanced) break;
      }
    },
  };
}
