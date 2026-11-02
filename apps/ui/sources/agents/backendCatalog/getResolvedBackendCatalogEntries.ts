import { buildBackendTargetKey, isBuiltInAgentTarget, type BackendTargetRefV1 } from '@piggercode/protocol';

import type { AgentId } from '@/agents/catalog/catalog';
import { getAgentCore, isAgentId } from '@/agents/catalog/catalog';
import { t } from '@/text';

export type ResolvedBackendCatalogEntry = Readonly<{
    target: BackendTargetRefV1;
    targetKey: string;
    family: 'builtInAgent';
    providerAgentId: AgentId;
    builtInAgentId: AgentId | null;
    iconAgentId: AgentId;
    title: string;
    subtitle: string | null;
}>;

export function getResolvedBackendCatalogEntries(params: Readonly<{
    enabledAgentIds: readonly AgentId[];
    backendEnabledByTargetKey?: Readonly<Record<string, boolean>> | null;
}>): ResolvedBackendCatalogEntry[] {
    const builtIns: ResolvedBackendCatalogEntry[] = params.enabledAgentIds
        .map((agentId) => {
            const core = getAgentCore(agentId);
            const target: BackendTargetRefV1 = { kind: 'builtInAgent', agentId };
            return {
                target,
                targetKey: buildBackendTargetKey(target),
                family: 'builtInAgent',
                providerAgentId: agentId,
                builtInAgentId: agentId,
                iconAgentId: agentId,
                title: t(core.displayNameKey),
                subtitle: agentId,
            };
        });

    return builtIns;
}

/**
 * The name the app shows for a built-in agent — "Codex", never the raw `codex` id — or
 * `null` when the id is not a catalog agent at all (a machine-reported native review engine, or a
 * stale persisted settings entry).
 *
 * This is the one owner for that lookup. Execution-run rows, the run launcher, action field
 * options and the voice review-engine tool each used to carry their own copy, and they disagreed:
 * some fell back to the id, some cast blindly into `getAgentCore`, and the run list painted the
 * raw id outright. Call this instead of reaching for `getAgentCore(...).displayNameKey`.
 */
export function resolveBuiltInAgentTitle(id: string): string | null {
    return isAgentId(id) ? t(getAgentCore(id).displayNameKey) : null;
}

export function resolveProviderAgentIdForBackendTarget(target: BackendTargetRefV1): AgentId {
    return isAgentId(target.agentId) ? target.agentId : 'claude';
}

export function resolveBuiltInAgentIdForBackendTarget(target: BackendTargetRefV1): AgentId {
    return resolveProviderAgentIdForBackendTarget(target);
}
