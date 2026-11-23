import {
    CONNECTED_SERVICES_MANAGEMENT_MIN_CLI_VERSION,
    isConnectedServiceSubscriptionLogin,
    isMachineReplaced,
    type ConnectedServiceId,
} from '@piggercode/protocol';

import type { Machine } from '@/sync/domains/state/storageTypes';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { isVersionSupported } from '@/utils/system/versionUtils';

export type ManagingMachineChangeVerdict =
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; reason: 'enrolled_profiles' }>
    | Readonly<{ ok: false; reason: 'incompatible_machines'; machineNames: readonly string[] }>;

function isKnownMachine(machine: Machine): boolean {
    return !isMachineReplaced(machine) && !(typeof machine.revokedAt === 'number' && machine.revokedAt > 0);
}

/** Known machines (not revoked or replaced) whose CLI is older than, or does not report, the managing-setting version. */
export function listMachinesWithoutManagementSupport(machines: readonly Machine[]): readonly Machine[] {
    return machines.filter((machine) => isKnownMachine(machine) && !isVersionSupported(
        machine.metadata?.happyCliVersion,
        CONNECTED_SERVICES_MANAGEMENT_MIN_CLI_VERSION,
    ));
}

export function hasEnrolledSubscriptionProfiles(
    connectedServicesV2: ReadonlyArray<Readonly<{ serviceId: ConnectedServiceId; profiles: ReadonlyArray<unknown> }>>,
): boolean {
    return connectedServicesV2.some((service) => (
        isConnectedServiceSubscriptionLogin(service.serviceId) && service.profiles.length > 0
    ));
}

/**
 * Changing the managing machine moves the rotating refresh tokens' owner, so it is refused while any
 * subscription login is enrolled; picking a machine while none is set is always the first choice.
 */
export function evaluateManagingMachineChange(params: Readonly<{
    currentMachineId: string | null;
    nextMachineId: string | null;
    machines: readonly Machine[];
    connectedServicesV2: ReadonlyArray<Readonly<{ serviceId: ConnectedServiceId; profiles: ReadonlyArray<unknown> }>>;
}>): ManagingMachineChangeVerdict {
    if (params.nextMachineId === params.currentMachineId) return { ok: true };
    if (params.currentMachineId !== null && hasEnrolledSubscriptionProfiles(params.connectedServicesV2)) {
        return { ok: false, reason: 'enrolled_profiles' };
    }
    if (params.nextMachineId === null) return { ok: true };
    const unsupported = listMachinesWithoutManagementSupport(params.machines);
    if (unsupported.length > 0) {
        return {
            ok: false,
            reason: 'incompatible_machines',
            machineNames: unsupported.map((machine) => getMachineDisplayName(machine) ?? machine.id),
        };
    }
    return { ok: true };
}
