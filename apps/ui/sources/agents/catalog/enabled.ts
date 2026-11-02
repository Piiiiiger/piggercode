import { buildBackendTargetKey } from '@piggercode/protocol';
import type { AgentId } from '@/agents/registry/registryCore';
import { AGENT_IDS, isAgentId } from '@/agents/registry/registryCore';
import { readAppBrandConfig } from '@/sync/runtime/appBrand';

/**
 * The agents this build offers (`extra.app.agentIds` from app.config.js), or null when it names none and
 * every catalog agent is offered. Agents left out stay in the catalog, so their sessions still render.
 */
function readOfferedAgentIds(): ReadonlySet<AgentId> | null {
    const configured = readAppBrandConfig().agentIds;
    if (!Array.isArray(configured)) return null;
    const agentIds = configured.filter(isAgentId);
    return agentIds.length > 0 ? new Set(agentIds) : null;
}

/** Whether this build offers the agent at all: screens that list agents leave out the ones it does not. */
export function isAgentOffered(agentId: AgentId): boolean {
    const offered = readOfferedAgentIds();
    return offered === null || offered.has(agentId);
}

function isBackendSwitchedOn(agentId: AgentId, backendEnabledByTargetKey: Record<string, boolean> | null | undefined): boolean {
    const targetKey = buildBackendTargetKey({ kind: 'builtInAgent', agentId });
    return backendEnabledByTargetKey?.[targetKey] !== false;
}

export function isAgentEnabled(params: {
    agentId: AgentId;
    backendEnabledByTargetKey: Record<string, boolean> | null | undefined;
}): boolean {
    return isAgentOffered(params.agentId) && isBackendSwitchedOn(params.agentId, params.backendEnabledByTargetKey);
}

export function getEnabledAgentIds(params: {
    backendEnabledByTargetKey: Record<string, boolean> | null | undefined;
}): AgentId[] {
    const offered = readOfferedAgentIds();
    return AGENT_IDS.filter((agentId) =>
        (offered === null || offered.has(agentId))
        && isBackendSwitchedOn(agentId, params.backendEnabledByTargetKey),
    );
}
