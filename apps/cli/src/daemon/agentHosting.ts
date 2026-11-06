import { SPAWN_SESSION_ERROR_CODES, type SpawnSessionErrorCode } from '@piggercode/protocol';

import {
  DAEMON_SERVICE_BUNDLE_ID_ENV_KEY,
  DAEMON_SERVICE_MANAGED_BY_ENV_KEY,
  parseDaemonServiceBundleId,
  parseDaemonServiceManagedBy,
} from './service/plan';

/**
 * Which machines run agent sessions (Codex, Claude Code). A computer connected through the desktop
 * app runs none: it lends folders and remote commands to the account's servers, and the agents run
 * there (the owner's decision, 2026-11-06). Every other machine runs them as before.
 *
 * Its background service says so: every install the desktop app performs names the app
 * (`PIGGERCODE_DAEMON_SERVICE_BUNDLE_ID`, R16), the default-following service as well as one for a
 * further relay, which is also desktop-managed (`PIGGERCODE_DAEMON_SERVICE_MANAGED_BY=desktop`). A
 * terminal install has neither.
 *
 * The daemon publishes this as `agentsHosted` in its machine metadata, so the app never offers such a
 * computer as a place to run an agent, and refuses every session start itself, whoever asks.
 */
export function daemonHostsAgents(env: NodeJS.ProcessEnv = process.env): boolean {
  return !installedByDesktopApp(env);
}

function installedByDesktopApp(env: NodeJS.ProcessEnv): boolean {
  // A value the desktop app does not write is not its install.
  try {
    if (parseDaemonServiceManagedBy(env[DAEMON_SERVICE_MANAGED_BY_ENV_KEY]) === 'desktop') return true;
  } catch {}
  try {
    return parseDaemonServiceBundleId(env[DAEMON_SERVICE_BUNDLE_ID_ENV_KEY]) !== null;
  } catch {
    return false;
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
