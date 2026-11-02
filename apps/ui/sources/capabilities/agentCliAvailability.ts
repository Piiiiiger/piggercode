import type { AgentId } from '@/agents/catalog/catalog';
import type { CapabilityDetectResult, CapabilityId } from '@/sync/api/capabilities/capabilitiesProtocol';

import { buildAgentCliCapabilityId } from './agentCliCapabilityId';

function isCliAvailable(result: CapabilityDetectResult | undefined): boolean {
    if (!result?.ok) return false;
    const data = result.data;
    return Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as { available?: unknown }).available === true);
}

/** The agents in `agentIds` whose CLI a machine's capability detect found available, in `agentIds` order. */
export function listAvailableAgentClis(
    results: Readonly<Partial<Record<CapabilityId, CapabilityDetectResult>>> | null | undefined,
    agentIds: ReadonlyArray<AgentId>,
): AgentId[] {
    if (!results) return [];
    return agentIds.filter((agentId) => isCliAvailable(results[buildAgentCliCapabilityId(agentId)]));
}
