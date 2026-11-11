import type { AgentState } from '../types';
import { resolveAgentRequestKind } from '@/agent/permissions/requestKind';
import {
  CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE,
  CLAUDE_LOCAL_PERMISSION_BRIDGE_STOPPED_REASON,
  isAgentStateRequestCoveredByCompletedRequests,
} from '@piggercode/agents';

type ActivitySummary = Readonly<{
  pendingPermissionRequestCount: number;
  pendingUserActionRequestCount: number;
}>;

const PENDING_REQUEST_COVERAGE_OPTIONS = {
  equivalentSources: [CLAUDE_LOCAL_PERMISSION_BRIDGE_REQUEST_SOURCE],
  equivalentCompletedStatuses: ['canceled'],
  equivalentCompletedReasons: [CLAUDE_LOCAL_PERMISSION_BRIDGE_STOPPED_REASON],
} as const;

export function deriveActivitySummaryFromAgentState(agentState: AgentState | null | undefined): ActivitySummary {
  // What a 「终端」 session's terminal waits for is a pending request too, though only the terminal answers it.
  const terminalWaitingOn = agentState?.terminalWaiting?.on;
  let pendingPermissionRequestCount = terminalWaitingOn === 'permission' ? 1 : 0;
  let pendingUserActionRequestCount = terminalWaitingOn === 'question' || terminalWaitingOn === 'exited' ? 1 : 0;

  const requests = agentState?.requests;
  const completedRequests = agentState?.completedRequests ?? null;
  if (!requests || typeof requests !== 'object') {
    return {
      pendingPermissionRequestCount,
      pendingUserActionRequestCount,
    };
  }

  for (const [requestId, request] of Object.entries(requests)) {
    if (!request || typeof request !== 'object') continue;
    const toolName = typeof request.tool === 'string' ? request.tool : '';
    if (!toolName) continue;
    if (isAgentStateRequestCoveredByCompletedRequests({
      requestId,
      request,
      completedRequests: completedRequests as Record<string, unknown> | null | undefined,
      options: PENDING_REQUEST_COVERAGE_OPTIONS,
    })) continue;

    const kind = request.kind === 'user_action' || request.kind === 'permission'
      ? request.kind
      : resolveAgentRequestKind(toolName);

    if (kind === 'user_action') {
      pendingUserActionRequestCount += 1;
    } else {
      pendingPermissionRequestCount += 1;
    }
  }

  return {
    pendingPermissionRequestCount,
    pendingUserActionRequestCount,
  };
}
