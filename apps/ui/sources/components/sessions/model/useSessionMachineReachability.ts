import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { getStorage } from '@/sync/domains/state/storageStore';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { resolveSessionMachineReachability } from '@/components/sessions/model/resolveSessionMachineReachability';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { resolveDisplayMachineTargetForSessionFromState, type SessionMachineTargetState } from '@/sync/ops/sessionMachineTarget';

export function useSessionMachineReachability(sessionId: string): Readonly<{
    machineReachable: boolean;
    machineOnline: boolean;
    machineRpcTargetAvailable: boolean;
}> {
    const machineTarget = useSessionMachineTarget(sessionId);
    // The session's own computer, also while the relay has it inactive: it is then no target for calls
    // (`machineTarget` is null), and the session waits for it rather than counting as one whose computer is unknown.
    const sessionMachineId = getStorage()((state) =>
        resolveDisplayMachineTargetForSessionFromState({ state: state as SessionMachineTargetState, sessionId })?.machineId ?? null);
    const resolvedMachineId = machineTarget?.machineId ?? sessionMachineId;
    const machineStatus = getStorage()(useShallow((state) => {
        const resolvedMachine = resolvedMachineId ? state.machines[resolvedMachineId] ?? null : null;
        return {
            machineKnown: Boolean(resolvedMachine),
            machineOnline: resolvedMachine ? isMachineOnline(resolvedMachine) : false,
        };
    }));

    const machineOnline = machineStatus.machineOnline;
    const machineReachable = resolveSessionMachineReachability({
        machineIsKnown: machineStatus.machineKnown,
        machineIsOnline: machineOnline,
    });

    const machineRpcTargetAvailable = Boolean(machineTarget?.basePath);

    return React.useMemo(() => ({
        machineReachable,
        machineOnline,
        machineRpcTargetAvailable,
    }), [machineOnline, machineReachable, machineRpcTargetAvailable]);
}
