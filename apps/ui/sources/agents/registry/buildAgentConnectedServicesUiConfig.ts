import { AGENTS_CORE, type AgentId } from '@piggercode/agents';

import type { AgentCoreConfig } from './registryCore';

export function buildAgentConnectedServicesUiConfig(params: Readonly<{
    agentId: AgentId;
}>): AgentCoreConfig['connectedServices'] {
    return AGENTS_CORE[params.agentId].connectedServices ?? null;
}
