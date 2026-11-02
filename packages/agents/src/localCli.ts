import type { AgentId } from './types.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

export type AgentCliAuthSupport = 'login_terminal' | 'status_only' | 'manual_only' | 'unsupported';

type AgentCliLaunchBase = Readonly<{
  kind: 'primary' | 'device_code';
  args: ReadonlyArray<string>;
  initialInput?: string | null;
}>;

export type AgentCliLaunchCommand =
  | (AgentCliLaunchBase & Readonly<{ target: 'provider_cli'; command: string }>)
  | (AgentCliLaunchBase & Readonly<{ target: 'happier_cli' }>);

export type AgentLocalCliConfig = Readonly<{
  agentId: AgentId;
  detectKey: string;
  machineLoginKey: string;
  authSupport: AgentCliAuthSupport;
  authLaunches: ReadonlyArray<AgentCliLaunchCommand>;
}>;

type AgentLocalCliConfigInput = Readonly<{
  machineLoginKey: string;
  authSupport: AgentCliAuthSupport;
  authLaunches: ReadonlyArray<
    Readonly<{
        kind: 'primary' | 'device_code';
        target?: 'provider_cli' | 'happier_cli';
        args: ReadonlyArray<string>;
        initialInput?: string | null;
      }>
  >;
}>;

function createAgentLocalCliConfig(agentId: AgentId, input: AgentLocalCliConfigInput): AgentLocalCliConfig {
  const binaryName = getProviderCliRuntimeSpec(agentId).binaryName;
  return {
    agentId,
    detectKey: binaryName,
    machineLoginKey: input.machineLoginKey,
    authSupport: input.authSupport,
    authLaunches: input.authLaunches.map((launch): AgentCliLaunchCommand => {
      const shared = {
        kind: launch.kind,
        args: launch.args,
        ...(launch.initialInput !== undefined ? { initialInput: launch.initialInput } : {}),
      };
      return launch.target === 'happier_cli'
        ? { ...shared, target: 'happier_cli' }
        : { ...shared, target: 'provider_cli', command: binaryName };
    }),
  };
}

export const AGENT_LOCAL_CLI_CONFIG: Readonly<Record<AgentId, AgentLocalCliConfig>> = Object.freeze({
  claude: createAgentLocalCliConfig('claude', {
    machineLoginKey: 'claude-code',
    authSupport: 'login_terminal',
    authLaunches: [{
      kind: 'primary',
      args: [],
      initialInput: '/login\r',
    }],
  }),
  codex: createAgentLocalCliConfig('codex', {
    machineLoginKey: 'codex',
    authSupport: 'login_terminal',
    authLaunches: [{
      kind: 'primary',
      args: ['login'],
    }],
  }),
});

export function getAgentLocalCliConfig(agentId: AgentId): AgentLocalCliConfig {
  return AGENT_LOCAL_CLI_CONFIG[agentId];
}
