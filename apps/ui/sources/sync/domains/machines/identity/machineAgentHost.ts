import type { Machine } from '@/sync/domains/state/storageTypes';

import { isMachineVisibleForLaunchSelection } from './filterVisibleMachines';

/**
 * Whether agent sessions (Codex, Claude Code) run on this machine. A computer connected through the
 * desktop app reports `agentsHosted: false` (its daemon decides, and refuses every session start
 * itself): it lends folders and remote commands to the account's servers, where the agents run, and
 * is never offered as a place to run one. Machines that do not report it — servers, older daemons —
 * run agents.
 */
export function isMachineAgentHost(machine: Readonly<{ metadata?: Machine['metadata'] | null }> | null | undefined): boolean {
    return machine?.metadata?.agentsHosted !== false;
}

/** A machine a session can be started, resumed or moved on: visible for launch, and runs agents. */
export function isMachineLaunchTarget(machine: Machine): boolean {
    return isMachineVisibleForLaunchSelection(machine) && isMachineAgentHost(machine);
}
