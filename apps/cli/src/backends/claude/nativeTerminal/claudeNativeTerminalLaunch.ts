import { readSpawnConfigOptionOverrideValue } from '@piggercode/protocol';

import { resolveClaudeEffectiveEffortForModel, resolveClaudeUltracodeForModel } from '@/backends/claude/utils/claudeEffort';
import { resolveClaudeSdkPermissionModeFromEnhancedMode } from '@/backends/claude/utils/permissionMode';
import type { NativeTerminalControls } from '@/terminal/nativeTerminal/runNativeTerminal';

import type { ClaudeReplyChoices } from './claudeTranscriptReplyChoices';

export type ClaudeNativeTerminalLaunch = Readonly<{
  /** The Claude conversation this terminal runs; stored as the session's `claudeSessionId`. */
  claudeSessionId: string;
  /** Everything PiggerCode passes to `claude`: the renderer, the conversation, the screen's choices and the first prompt. */
  args: readonly string[];
}>;

/**
 * Claude Code's fullscreen renderer, given as a flag. A running `claude` switches renderer when `tui` changes in a
 * settings file, and a session switched out of the fullscreen renderer that way stays blank or cut off until claude
 * restarts (2026-11-11: every terminal started before `~/.claude/settings.json` got `"tui": "default"`). A flag
 * outranks the settings files, so no later edit reaches a running terminal. Fullscreen rather than default: each
 * device views a session through its own tmux client, and the window takes the size of the device in use; the
 * fullscreen renderer draws its screen anew at every size, while the default one reflows what it printed into
 * broken, repeated lines (2026-11-14, phone and computer open at once).
 * Claude reads one `--settings` flag, so Ultracode, when chosen, goes in the same one.
 */
function claudeSettingsArgs(ultracode: boolean): string[] {
  return ['--settings', JSON.stringify(ultracode ? { tui: 'fullscreen', ultracode: true } : { tui: 'fullscreen' })];
}

/**
 * What a 「终端」 session asks `claude` for. A conversation with a transcript is resumed; one that
 * has none yet (Claude writes it with the first message) starts again under the same id, so reopening
 * a terminal that was closed before anyone typed does not fail on "no conversation found".
 * A resumed conversation goes on with the model and thinking level it last answered with
 * (`lastReplyChoices`), unless the request chose others: claude's own `--resume` keeps neither and
 * would take the ones in its settings files. A level goes only with the model it was used with.
 */
export function planClaudeNativeTerminalLaunch(params: Readonly<{
  resumeClaudeSessionId: string | null;
  /** Typed in the new-session screen; after `--` so text that starts with a dash stays text. */
  firstPrompt: string | null;
  controls: NativeTerminalControls;
  transcriptExists: (claudeSessionId: string) => boolean;
  /** The model and thinking level the conversation to resume last answered with, when known. */
  lastReplyChoices?: ClaudeReplyChoices | null;
  newClaudeSessionId: () => string;
}>): ClaudeNativeTerminalLaunch {
  const resume = params.resumeClaudeSessionId?.trim() ?? '';
  const resuming = resume !== '' && params.transcriptExists(resume);
  const lastReply = resuming ? params.lastReplyChoices ?? null : null;
  const modelId = params.controls.modelId ?? lastReply?.modelId ?? null;
  const effort = readSpawnConfigOptionOverrideValue(params.controls.configOptionOverrides, 'reasoning_effort')
    ?? (lastReply && lastReply.modelId === modelId ? lastReply.effort : null);
  const ultracode = resolveClaudeUltracodeForModel({
    modelId,
    ultracode: readSpawnConfigOptionOverrideValue(params.controls.configOptionOverrides, 'ultracode'),
  });
  const settings = claudeSettingsArgs(ultracode);
  const choices = claudeControlArgs({ controls: params.controls, modelId, effort, ultracode });
  const prompt = params.firstPrompt ? ['--', params.firstPrompt] : [];
  if (resuming) {
    return { claudeSessionId: resume, args: [...settings, '--resume', resume, ...choices, ...prompt] };
  }
  const claudeSessionId = resume || params.newClaudeSessionId();
  return { claudeSessionId, args: [...settings, '--session-id', claudeSessionId, ...choices, ...prompt] };
}

/**
 * The model and thinking level to run (the new-session screen's, or the resumed conversation's own) and the chosen
 * permissions; plan mode is one of Claude's permission modes. A thinking level goes as a flag even when it is the
 * model's usual one: claude would otherwise use the level in its own settings files, which the screen does not show.
 * Ultracode sets the level itself.
 */
function claudeControlArgs(params: Readonly<{
  controls: NativeTerminalControls;
  modelId: string | null;
  effort: unknown;
  ultracode: boolean;
}>): string[] {
  const { controls, modelId } = params;
  const args = modelId ? ['--model', modelId] : [];
  const effort = params.ultracode ? null : resolveClaudeEffectiveEffortForModel({ modelId, effort: params.effort });
  if (effort) args.push('--effort', effort);
  const permissionMode = resolveClaudeSdkPermissionModeFromEnhancedMode({
    permissionMode: controls.permissionMode ?? 'default',
    agentModeId: controls.agentModeId,
  });
  if (permissionMode !== 'default') args.push('--permission-mode', permissionMode);
  return args;
}
