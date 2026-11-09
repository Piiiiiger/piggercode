export type ClaudeNativeTerminalLaunch = Readonly<{
  /** The Claude conversation this terminal runs; stored as the session's `claudeSessionId`. */
  claudeSessionId: string;
  /** Everything PiggerCode passes to `claude`: the conversation to start or resume and the first prompt. */
  args: readonly string[];
}>;

/**
 * What a 「终端」 session asks `claude` for. A conversation with a transcript is resumed; one that
 * has none yet (Claude writes it with the first message) starts again under the same id, so reopening
 * a terminal that was closed before anyone typed does not fail on "no conversation found".
 */
export function planClaudeNativeTerminalLaunch(params: Readonly<{
  resumeClaudeSessionId: string | null;
  /** Typed in the new-session screen; after `--` so text that starts with a dash stays text. */
  firstPrompt: string | null;
  transcriptExists: (claudeSessionId: string) => boolean;
  newClaudeSessionId: () => string;
}>): ClaudeNativeTerminalLaunch {
  const prompt = params.firstPrompt ? ['--', params.firstPrompt] : [];
  const resume = params.resumeClaudeSessionId?.trim() ?? '';
  if (resume && params.transcriptExists(resume)) {
    return { claudeSessionId: resume, args: ['--resume', resume, ...prompt] };
  }
  const claudeSessionId = resume || params.newClaudeSessionId();
  return { claudeSessionId, args: ['--session-id', claudeSessionId, ...prompt] };
}
