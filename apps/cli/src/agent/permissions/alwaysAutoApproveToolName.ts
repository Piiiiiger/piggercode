import { isChangeTitleToolLikeName } from '@piggercode/protocol/tools/v2';

const TRUSTED_SAFE_TOOL_NAMES = new Set([
  'think',
  'save_memory',
  'mcp__piggercode__think',
  'mcp__piggercode__save_memory',
  'mcp__happy__think',
  'mcp__happy__save_memory',
  'piggercode__think',
  'piggercode__save_memory',
  'happy__think',
  'happy__save_memory',
  'piggercode_think',
  'piggercode_save_memory',
  'happy_think',
  'happy_save_memory',
]);

export function isTrustedAlwaysAutoApproveToolName(
  toolName: string,
  additionalExactNames: readonly string[] = [],
): boolean {
  const normalized = String(toolName ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (isChangeTitleToolLikeName(normalized)) return true;
  if (TRUSTED_SAFE_TOOL_NAMES.has(normalized)) return true;
  return additionalExactNames.some((name) => normalized === name.trim().toLowerCase());
}
