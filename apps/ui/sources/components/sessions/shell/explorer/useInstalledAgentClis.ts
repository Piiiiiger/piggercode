import * as React from 'react';
import type { AgentId } from '@happier-dev/agents';

import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { listAvailableAgentClis } from '@/capabilities/agentCliAvailability';
import { CAPABILITIES_NEW_SESSION_STALE_MS, CAPABILITIES_REQUEST_NEW_SESSION } from '@/capabilities/requests';
import {
    getMachineCapabilitiesSnapshot,
    prefetchMachineCapabilitiesIfStale,
    subscribeMachineCapabilitiesCacheState,
} from '@/hooks/server/useMachineCapabilitiesCache';
import type { SessionExplorerMachineSummary } from '@/sync/domains/state/storage';
import { fireAndForget } from '@/utils/system/fireAndForget';

const NO_AGENTS: ReadonlyArray<AgentId> = Object.freeze([]);

/**
 * The enabled agents whose CLI an online machine has, read from the capability cache the
 * new-session flow fills. `detect` refreshes stale machines; call it when the user opens a picker.
 */
export function useInstalledAgentClis(params: Readonly<{
    serverId: string | null;
    machines: ReadonlyArray<SessionExplorerMachineSummary>;
}>): Readonly<{ installed: ReadonlyArray<AgentId>; detect: () => void }> {
    const enabledAgentIds = useEnabledAgentIds();
    const { serverId } = params;
    const online = React.useMemo(() => params.machines.filter((machine) => machine.online), [params.machines]);

    const subscribe = React.useCallback((listener: () => void) => {
        const unsubscribes = online.map((machine) => (
            subscribeMachineCapabilitiesCacheState(machine.machineId, serverId, machine.daemonStateVersion, listener)
        ));
        return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    }, [online, serverId]);

    const lastRef = React.useRef<Readonly<{ key: string; installed: ReadonlyArray<AgentId> }>>({ key: '', installed: NO_AGENTS });
    const getSnapshot = React.useCallback(() => {
        const found = new Set<AgentId>();
        for (const machine of online) {
            const snapshot = getMachineCapabilitiesSnapshot(machine.machineId, serverId, machine.daemonStateVersion);
            for (const agentId of listAvailableAgentClis(snapshot?.response.results, enabledAgentIds)) found.add(agentId);
        }
        const installed = enabledAgentIds.filter((agentId) => found.has(agentId));
        const key = installed.join(',');
        if (lastRef.current.key !== key) lastRef.current = { key, installed };
        return lastRef.current.installed;
    }, [enabledAgentIds, online, serverId]);
    const installed = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const detect = React.useCallback(() => {
        for (const machine of online) {
            fireAndForget(prefetchMachineCapabilitiesIfStale({
                machineId: machine.machineId,
                serverId,
                cacheKeySalt: machine.daemonStateVersion,
                staleMs: CAPABILITIES_NEW_SESSION_STALE_MS,
                request: CAPABILITIES_REQUEST_NEW_SESSION,
            }), { tag: 'sessionListAgentPicker.detectInstalledClis' });
        }
    }, [online, serverId]);

    return { installed, detect };
}
