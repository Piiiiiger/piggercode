import { SPAWN_SESSION_ERROR_CODES, type SpawnSessionErrorCode } from '@piggercode/protocol';

import { DAEMON_SERVICE_MANAGED_BY_ENV_KEY, parseDaemonServiceManagedBy } from './service/plan';

/**
 * Which machines run agent sessions (Codex, Claude Code). A computer connected through the desktop
 * app — its background service is desktop-managed — runs none: it lends folders and remote commands
 * to the account's servers, and the agents run there (the owner's decision, 2026-11-06). Every other
 * machine runs them as before.
 *
 * The daemon publishes this as `agentsHosted` in its machine metadata, so the app never offers such a
 * computer as a place to run an agent, and refuses every session start itself, whoever asks.
 */
export function daemonHostsAgents(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return parseDaemonServiceManagedBy(env[DAEMON_SERVICE_MANAGED_BY_ENV_KEY]) !== 'desktop';
  } catch {
    // Not a value the desktop app writes, so not a desktop-managed service.
    return true;
  }
}

/** The answer to any session start on such a computer. */
export function agentsNotHostedResult(): { type: 'error'; errorCode: SpawnSessionErrorCode; errorMessage: string } {
  return {
    type: 'error',
    errorCode: SPAWN_SESSION_ERROR_CODES.AGENTS_NOT_HOSTED,
    errorMessage: 'This computer does not run Codex or Claude Code: agents run on the account\'s servers, and this computer only shares folders and runs remote commands for them.',
  };
}
