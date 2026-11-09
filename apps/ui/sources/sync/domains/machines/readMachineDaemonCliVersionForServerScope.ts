import type { Machine } from '@/sync/domains/state/storageTypes';

type MachineDaemonCliVersionState = Readonly<{
    machines: Readonly<Record<string, Machine | undefined>>;
    machineListByServerId?: Readonly<Record<string, readonly Machine[] | null | undefined>>;
}>;

type MachineServerScopeParams = Readonly<{
    state: MachineDaemonCliVersionState;
    machineId: string;
    serverId?: string | null;
    activeServerId?: string | null;
}>;

/** The machine record as the target server sees it: the active server's map, or that server's own list. */
export function readMachineForServerScope(params: MachineServerScopeParams): Machine | undefined {
    const machineId = typeof params.machineId === 'string' ? params.machineId.trim() : '';
    if (!machineId) return undefined;

    const serverId = typeof params.serverId === 'string' ? params.serverId.trim() : '';
    const activeServerId = typeof params.activeServerId === 'string' ? params.activeServerId.trim() : '';
    return !serverId || serverId === activeServerId
        ? params.state.machines[machineId]
        : activeServerId
            ? params.state.machineListByServerId?.[serverId]?.find((candidate) => candidate.id === machineId)
            : undefined;
}

export function readMachineDaemonCliVersionForServerScope(params: MachineServerScopeParams): string | null {
    const version = readMachineForServerScope(params)?.daemonState?.startedWithCliVersion;
    return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null;
}

/**
 * Whether the machine's daemon starts 「终端」 sessions (it publishes `daemonNativeTerminalSessionsSupported`).
 * An older daemon would drop the request's `nativeTerminal`, or the session's, and run a chat instead,
 * so starting and reopening a terminal session both ask this first.
 */
export function machineStartsNativeTerminalSessions(params: MachineServerScopeParams): boolean {
    return machineRecordStartsNativeTerminalSessions(readMachineForServerScope(params));
}

export function machineRecordStartsNativeTerminalSessions(machine: Machine | null | undefined): boolean {
    return machine?.metadata?.daemonNativeTerminalSessionsSupported === true;
}
