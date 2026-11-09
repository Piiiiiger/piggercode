export type ClaudeNativeTerminalLaunch = Readonly<{
  /** The Claude conversation this terminal runs; stored as the session's `claudeSessionId`. */
  claudeSessionId: string;
  /** Everything PiggerCode passes to `claude`: the conversation to start or resume, nothing else. */
  args: readonly string[];
}>;

/**
 * What a 「终端」 session asks `claude` for. A conversation with a transcript is resumed; one that
 * has none yet (Claude writes it with the first message) starts again under the same id, so reopening
 * a terminal that was closed before anyone typed does not fail on "no conversation found".
 */
export function planClaudeNativeTerminalLaunch(params: Readonly<{
  resumeClaudeSessionId: string | null;
  transcriptExists: (claudeSessionId: string) => boolean;
  newClaudeSessionId: () => string;
}>): ClaudeNativeTerminalLaunch {
  const resume = params.resumeClaudeSessionId?.trim() ?? '';
  if (resume && params.transcriptExists(resume)) {
    return { claudeSessionId: resume, args: ['--resume', resume] };
  }
  const claudeSessionId = resume || params.newClaudeSessionId();
  return { claudeSessionId, args: ['--session-id', claudeSessionId] };
}
