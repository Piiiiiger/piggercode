import type { AgentId, PermissionMode } from './types.js';
import { AGENTS_CORE } from './manifest.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

export type BuiltInAcpTransportProfile = 'generic';
export type BuiltInAcpYesNoAuto = 'yes' | 'no' | 'auto';

export type BuiltInAcpConfig = Readonly<{
  agentId: AgentId;
  launcher: Readonly<{
    command: string;
    args: ReadonlyArray<string>;
  }>;
  transportProfile: BuiltInAcpTransportProfile;
  supportsLoadSession: boolean;
  supportsModes: BuiltInAcpYesNoAuto;
  supportsModels: BuiltInAcpYesNoAuto;
  promptImageSupport: BuiltInAcpYesNoAuto;
  /** Whether Happier's MCP server list is passed to the ACP session/new request. */
  mcpServers?: 'pass' | 'drop';
  /** Provider ACP mode selected for each explicit Happier permission intent. Null means no override. */
  permissionModeMapping?: Readonly<Partial<Record<PermissionMode, string | null>>>;
}>;

function providerLauncherCommand(agentId: AgentId): string {
  return getProviderCliRuntimeSpec(agentId).binaryName;
}

export const BUILT_IN_ACP_CONFIG: Readonly<Partial<Record<AgentId, BuiltInAcpConfig>>> = Object.freeze({
});

export function hasBuiltInAcpConfig(agentId: AgentId): boolean {
  return BUILT_IN_ACP_CONFIG[agentId] != null;
}

export function getBuiltInAcpConfig(agentId: AgentId): BuiltInAcpConfig | null {
  return BUILT_IN_ACP_CONFIG[agentId] ?? null;
}
