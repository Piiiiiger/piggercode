import { AGENTS } from '@/backends/catalog';
import type { CatalogAgentId } from '@/backends/types';
import type { BackendTargetRefV1, ConnectedServiceBindingsV1 } from '@piggercode/protocol';

export function resolveAgentProbeVariant(params: Readonly<{
  agentId: CatalogAgentId;
  backendTarget?: BackendTargetRefV1;
  accountSettings?: Readonly<Record<string, unknown>> | null;
  connectedServices?: ConnectedServiceBindingsV1 | null;
  processEnv?: NodeJS.ProcessEnv;
}>): string {
  const entry = AGENTS[params.agentId];
  const entryVariant = entry?.resolveModelsProbeVariant?.({
    backendTarget: params.backendTarget,
    accountSettings: params.accountSettings ?? null,
    connectedServices: params.connectedServices ?? null,
    processEnv: params.processEnv,
  }) ?? null;
  return entryVariant ?? `${params.agentId}:default`;
}
