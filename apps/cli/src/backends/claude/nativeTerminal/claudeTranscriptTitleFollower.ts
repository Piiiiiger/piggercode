import { readClaudeTitleRecord } from '@/backends/claude/directSessions/readClaudeSessionTitle';
import { createJsonlFileTail } from '@/terminal/nativeTerminal/jsonlFileTail';

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
  const tail = createJsonlFileTail(transcriptPath);
  let customTitle: string | null = null;
  let aiTitle: string | null = null;
  let published: string | null = null;

  const readChanges = async (): Promise<string | null> => {
    await tail.readNew((value) => {
      const titleRecord = readClaudeTitleRecord(value);
      if (titleRecord?.kind === 'custom') customTitle = titleRecord.title;
      if (titleRecord?.kind === 'ai') aiTitle = titleRecord.title;
    });
    const title = customTitle ?? aiTitle;
    if (!title || title === published) return null;
    published = title;
    return title;
  };

  return { readChanges };
}
