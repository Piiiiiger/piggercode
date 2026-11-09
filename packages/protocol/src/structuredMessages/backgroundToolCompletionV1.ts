import { z } from 'zod';

/**
 * A tool call that was still running when the agent ended its turn, and finished afterwards.
 *
 * Codex runs MCP tools from scripts that hand control back to the model after a while; the model can
 * then end its turn before the tool returns (for example a remote command waiting on approval or on a
 * slow machine). Nothing would tell the model the result arrived, so the session sends it this
 * automated input, and the app shows it as a small notice instead of a user message.
 */
export const BACKGROUND_TOOL_COMPLETION_KIND = 'background_tool_completion.v1';

export const BackgroundToolCompletionV1Schema = z.object({
  v: z.literal(1),
  callId: z.string().min(1),
  /** The tool's canonical name, e.g. `mcp__piggercode__machine_command_run`. */
  toolName: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  finishedAtMs: z.number().int().nonnegative(),
}).passthrough();

export type BackgroundToolCompletionV1 = z.infer<typeof BackgroundToolCompletionV1Schema>;

function buildBackgroundToolCompletionText(completion: BackgroundToolCompletionV1): string {
  return [
    '<piggercode_background_tool_notification>',
    'This is an automated notification from PiggerCode, not a user message.',
    `A tool call that was still running when your last turn ended has ${completion.status === 'failed' ? 'failed' : 'finished'}.`,
    `Tool: ${completion.toolName}`,
    `Call ID: ${completion.callId}`,
    'If it ran inside a script, wait for that script to read its output. Then continue the task and tell the user the result.',
    '</piggercode_background_tool_notification>',
  ].join('\n');
}

export function buildBackgroundToolCompletionInputV1(value: BackgroundToolCompletionV1): Readonly<{
  text: string;
  meta: Record<string, unknown>;
}> {
  const completion = BackgroundToolCompletionV1Schema.parse(value);
  return {
    text: buildBackgroundToolCompletionText(completion),
    meta: {
      source: 'background_tool',
      sentFrom: 'happier',
      happier: { kind: BACKGROUND_TOOL_COMPLETION_KIND, payload: completion },
    },
  };
}
