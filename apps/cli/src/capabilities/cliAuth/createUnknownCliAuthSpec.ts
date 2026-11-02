import type { CliAuthSpec } from './types';
import { createCatalogCliAuthSpec } from './createCatalogCliAuthSpec';
import type { AgentId } from '@piggercode/agents';

export function createUnknownCliAuthSpec(agentId: AgentId): CliAuthSpec {
  return createCatalogCliAuthSpec(agentId, {
    detectAuthStatus: async () => ({
      state: 'unknown',
      reason: 'unsupported',
    }),
  });
}
