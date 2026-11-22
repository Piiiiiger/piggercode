import { collectBugReportMachineDiagnosticsSnapshot } from '@/diagnostics/bugReportMachineDiagnostics';

import type { BugReportMachineDiagnosticsSnapshot } from '@/diagnostics/bugReportMachineDiagnostics';
import { DIAGNOSTIC_RECENT_DAEMON_LOG_COUNT } from '@/utils/logs/logRetention';

export const BUG_REPORT_MACHINE_DIAGNOSTICS_RECIPE = {
  daemonLogLimit: DIAGNOSTIC_RECENT_DAEMON_LOG_COUNT,
  stackLogLimit: 3,
  stackRuntimeMaxChars: 400_000,
} as const;

export async function collectBugReportMachineDiagnosticsSnapshotForBugReport(): Promise<BugReportMachineDiagnosticsSnapshot> {
  return await collectBugReportMachineDiagnosticsSnapshot(BUG_REPORT_MACHINE_DIAGNOSTICS_RECIPE);
}

