import type { AgentId } from './types.js';
import { getProviderCliBinaryNames, getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

export type AgentAuthProbeParser =
  | 'unknown'
  | 'claudeCredentialsFile'
  | 'codexLoginStatus';

export type AgentAuthProbeBackgroundChecks = 'safe' | 'manual_only';

export type AgentAuthProbeConfig = Readonly<{
  agentId: AgentId;
  binaryNames: ReadonlyArray<string>;
  statusCommand: ReadonlyArray<string> | null;
  parser: AgentAuthProbeParser;
  backgroundChecks: AgentAuthProbeBackgroundChecks;
  envVars?: ReadonlyArray<string>;
  credentialPaths?: ReadonlyArray<string>;
}>;

export const AGENT_AUTH_PROBE_CONFIG: Readonly<Record<AgentId, AgentAuthProbeConfig>> = Object.freeze({
  claude: {
    agentId: 'claude',
    binaryNames: [getProviderCliRuntimeSpec('claude').binaryName],
    statusCommand: null,
    parser: 'claudeCredentialsFile',
    backgroundChecks: 'safe',
    envVars: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    credentialPaths: ['~/.claude/.credentials.json', '~/.claude/.claude.json'],
  },
  codex: {
    agentId: 'codex',
    binaryNames: [getProviderCliRuntimeSpec('codex').binaryName],
    statusCommand: ['login', 'status'],
    parser: 'codexLoginStatus',
    backgroundChecks: 'safe',
    envVars: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    credentialPaths: ['~/.codex/auth.json'],
  },
});

export function getAgentAuthProbeConfig(
  agentId: AgentId,
  processEnv: NodeJS.ProcessEnv = process.env,
): AgentAuthProbeConfig {
  const config = AGENT_AUTH_PROBE_CONFIG[agentId];
  return {
    ...config,
    binaryNames: getProviderCliBinaryNames(agentId, processEnv),
  };
}

export function isAgentAuthProbeSafeForBackgroundChecks(agentId: AgentId): boolean {
  return getAgentAuthProbeConfig(agentId).backgroundChecks === 'safe';
}
