import * as React from 'react';

import { desktopSetupCoordinator, resolveThisComputerServiceForActiveRelay } from '@/setup/desktopSetupCoordinator';
import { isTauriDesktop } from '@/utils/platform/tauri';

/**
 * This computer's machine on the app's relay, from the one ambient inspection (never a read of its own). `null` off the
 * desktop app, and until the inspection has answered.
 */
export function useThisComputerMachineId(): string | null {
    const inspection = React.useSyncExternalStore(
        desktopSetupCoordinator.subscribe,
        desktopSetupCoordinator.readInspectionSnapshot,
        desktopSetupCoordinator.readInspectionSnapshot,
    );
    if (!isTauriDesktop()) return null;
    return resolveThisComputerServiceForActiveRelay(inspection)?.facts.auth.machineId ?? null;
}
