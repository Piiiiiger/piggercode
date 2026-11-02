import { getAgentAuthProbeConfig, type AgentId } from '@piggercode/agents';

import type { CliDetectSpec } from '@/backends/types';

export function createCatalogDefinedCliDetect(agentId: AgentId): CliDetectSpec {
  const authConfig = getAgentAuthProbeConfig(agentId);

  return {
    versionArgsToTry: [['--version'], ['version'], ['-v']],
    loginStatusArgs: authConfig.statusCommand ?? null,
  };
}
