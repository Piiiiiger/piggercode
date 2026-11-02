import type { BackendTargetRefV1 } from '@piggercode/protocol';

import { resolveBuiltInAgentTitle } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';

export function resolveExecutionRunBackendLabel(
    backendTarget: BackendTargetRefV1 | null | undefined,
): string | null {
    if (!backendTarget) return null;
    return resolveBuiltInAgentTitle(backendTarget.agentId) ?? backendTarget.agentId;
}
