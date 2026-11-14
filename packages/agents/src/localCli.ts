import type { AgentId } from './types.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

export type AgentCliAuthSupport = 'login_terminal' | 'status_only' | 'manual_only' | 'unsupported';

/**
 * `link_then_code`: the command prints a sign-in link and then waits for the code the sign-in page shows, so the app
 * can offer the link and a box for the code instead of a terminal.
 */
export type AgentCliSignInFlow = 'link_then_code';

type AgentCliLaunchBase = Readonly<{
  kind: 'primary' | 'device_code';
  args: ReadonlyArray<string>;
  initialInput?: string | null;
  signIn?: AgentCliSignInFlow;
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
        signIn?: AgentCliSignInFlow;
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
        ...(launch.signIn !== undefined ? { signIn: launch.signIn } : {}),
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
    // `claude auth login` (Claude Code 2.1): no folder-trust question, plain output, the code read from the terminal.
    authLaunches: [{
      kind: 'primary',
      args: ['auth', 'login'],
      signIn: 'link_then_code',
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
