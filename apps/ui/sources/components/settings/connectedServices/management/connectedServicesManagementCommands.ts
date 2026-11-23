import {
    ConnectedServicesManagementV1Schema,
    DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1,
    type ConnectedServicesManagementV1,
} from '@piggercode/protocol';

import { getCurrentAuth } from '@/auth/context/AuthContext';
import { fetchConnectedServicesInventory } from '@/sync/domains/connectedServices/storeConnectedServiceCredentialForAccount';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';

import {
    evaluateManagingMachineChange,
    listMachinesWithoutManagementSupport,
    type ManagingMachineChangeVerdict,
} from './connectedServicesManagementRules';

export type ConnectedServicesManagementCommandVerdict =
    | ManagingMachineChangeVerdict
    /** The settings, accounts or machines could not be read, or the settings changed meanwhile: nothing was written. */
    | Readonly<{ ok: false; reason: 'unconfirmed' }>;

class ManagementChangeRefused extends Error {
    constructor(readonly verdict: Exclude<ManagingMachineChangeVerdict, { ok: true }>) {
        super(verdict.reason);
    }
}

function parseManagement(value: unknown): ConnectedServicesManagementV1 {
    const parsed = ConnectedServicesManagementV1Schema.safeParse(value ?? DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1);
    return parsed.success ? parsed.data : DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1;
}

/**
 * The managing machine and the pause switch are decided on the server's settings, accounts and machines
 * read for this click, and written once against the settings version read: never queued (a queued write
 * could land after another client's change), never from what the page loaded with.
 */
async function updateManagement(
    decide: (current: ConnectedServicesManagementV1) => Promise<ConnectedServicesManagementV1 | undefined>,
): Promise<ConnectedServicesManagementCommandVerdict> {
    try {
        await getSyncSingleton().updateAccountSettingOnce({
            key: 'connectedServicesManagementV1',
            decide: async (current) => await decide(parseManagement(current)),
        });
        return { ok: true };
    } catch (error) {
        if (error instanceof ManagementChangeRefused) return error.verdict;
        return { ok: false, reason: 'unconfirmed' };
    }
}

function incompatibleMachinesRefusal(
    machines: Awaited<ReturnType<ReturnType<typeof getSyncSingleton>['readMachinesOrThrow']>>,
): ManagementChangeRefused | null {
    const unsupported = listMachinesWithoutManagementSupport(machines);
    if (unsupported.length === 0) return null;
    return new ManagementChangeRefused({
        ok: false,
        reason: 'incompatible_machines',
        machineNames: unsupported.map((machine) => getMachineDisplayName(machine) ?? machine.id),
    });
}

export async function changeManagingMachine(nextMachineId: string | null): Promise<ConnectedServicesManagementCommandVerdict> {
    const credentials = getCurrentAuth()?.credentials ?? null;
    if (!credentials) return { ok: false, reason: 'unconfirmed' };
    return await updateManagement(async (management) => {
        if (nextMachineId === management.managingMachineId) return undefined;
        const [connectedServicesV2, machines] = await Promise.all([
            fetchConnectedServicesInventory(credentials),
            getSyncSingleton().readMachinesOrThrow(),
        ]);
        const verdict = evaluateManagingMachineChange({
            currentMachineId: management.managingMachineId,
            nextMachineId,
            machines,
            connectedServicesV2,
        });
        if (!verdict.ok) throw new ManagementChangeRefused(verdict);
        return { ...management, managingMachineId: nextMachineId };
    });
}

/** Resuming pools is the same commitment as a launch: every machine the server lists must honour the setting. */
export async function setConnectedServicePoolsPaused(poolsPaused: boolean): Promise<ConnectedServicesManagementCommandVerdict> {
    return await updateManagement(async (management) => {
        if (management.poolsPaused === poolsPaused) return undefined;
        if (!poolsPaused) {
            const refusal = incompatibleMachinesRefusal(await getSyncSingleton().readMachinesOrThrow());
            if (refusal) throw refusal;
        }
        return { ...management, poolsPaused };
    });
}
