import { redactBugReportSensitiveText, trimBugReportTextToMaxBytes } from '@piggercode/protocol';

export function redactMcpServerProbeError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? '');
  return trimBugReportTextToMaxBytes(redactBugReportSensitiveText(text), 512).trim() || 'unknown error';
}
