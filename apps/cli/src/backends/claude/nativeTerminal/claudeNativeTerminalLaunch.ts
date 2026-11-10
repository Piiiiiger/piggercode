import { resolveClaudeSdkPermissionModeFromEnhancedMode } from '@/backends/claude/utils/permissionMode';
import type { NativeTerminalControls } from '@/terminal/nativeTerminal/runNativeTerminal';

export type ClaudeNativeTerminalLaunch = Readonly<{
  /** The Claude conversation this terminal runs; stored as the session's `claudeSessionId`. */
  claudeSessionId: string;
  /** Everything PiggerCode passes to `claude`: the conversation, the screen's choices and the first prompt. */
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
  controls: NativeTerminalControls;
  transcriptExists: (claudeSessionId: string) => boolean;
  newClaudeSessionId: () => string;
}>): ClaudeNativeTerminalLaunch {
  const choices = claudeControlArgs(params.controls);
  const prompt = params.firstPrompt ? ['--', params.firstPrompt] : [];
  const resume = params.resumeClaudeSessionId?.trim() ?? '';
  if (resume && params.transcriptExists(resume)) {
    return { claudeSessionId: resume, args: ['--resume', resume, ...choices, ...prompt] };
  }
  const claudeSessionId = resume || params.newClaudeSessionId();
  return { claudeSessionId, args: ['--session-id', claudeSessionId, ...choices, ...prompt] };
}

/** The model and permissions chosen in the new-session screen; plan mode is one of Claude's permission modes. */
function claudeControlArgs(controls: NativeTerminalControls): string[] {
  const args = controls.modelId ? ['--model', controls.modelId] : [];
  const permissionMode = resolveClaudeSdkPermissionModeFromEnhancedMode({
    permissionMode: controls.permissionMode ?? 'default',
    agentModeId: controls.agentModeId,
  });
  if (permissionMode !== 'default') args.push('--permission-mode', permissionMode);
  return args;
}
