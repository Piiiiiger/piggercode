import type {
    DaemonPetImportLocalPackageRequestV1,
    DiscoveredPetPackageV1,
    ImportedLocalPetPackageV1,
} from '@piggercode/protocol';

import type { LocalPetSourceMetadata } from '@/sync/domains/pets/localPetSourceMetadata';

import type {
    DesktopPetOverlayVisibilityModeOverride,
    DetectedPet,
    LocalDevicePetRow,
    ManagedLocalPet,
    PetEnabledOverride,
} from './types';

const PET_ENABLED_OVERRIDE_IDS = new Set(['inherit', 'enabled', 'disabled']);
const DESKTOP_PET_OVERLAY_VISIBILITY_MODE_OVERRIDE_IDS = new Set([
    'inherit',
    'attentionOrActive',
    'alwaysWhenEnabled',
    'attentionOnly',
]);

export const USE_ON_THIS_DEVICE_ACTION_ID = 'use-on-this-device';
export const IMPORT_TO_ACCOUNT_ACTION_ID = 'import-to-account';
export const REMOVE_FROM_DEVICE_ACTION_ID = 'remove-from-device';

export function isPetEnabledOverride(value: string): value is PetEnabledOverride {
    return PET_ENABLED_OVERRIDE_IDS.has(value);
}

export function isDesktopPetOverlayVisibilityModeOverride(
    value: string,
): value is DesktopPetOverlayVisibilityModeOverride {
    return DESKTOP_PET_OVERLAY_VISIBILITY_MODE_OVERRIDE_IDS.has(value);
}

export function sanitizeTestIdPart(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'pet';
}

export const sourceRowTestId = (scope: 'local' | 'account', sourceKey: string) =>
    `settings-pets-select-source-${scope}-${sanitizeTestIdPart(sourceKey)}`;
export const detectedRowTestId = (sourceKey: string) => `settings-pets-detected-source-${sanitizeTestIdPart(sourceKey)}`;
export const useOnDeviceActionTestId = (sourceKey: string) => `settings-pets-use-on-this-device-${sanitizeTestIdPart(sourceKey)}`;
export const importToAccountActionTestId = (sourceKey: string) => `settings-pets-import-to-account-${sanitizeTestIdPart(sourceKey)}`;
export const removeFromDeviceActionTestId = (sourceKey: string) => `settings-pets-remove-from-device-${sanitizeTestIdPart(sourceKey)}`;

export function upsertByKey<T>(rows: readonly T[], next: T, readKey: (row: T) => string): T[] {
    const nextKey = readKey(next);
    const existingIndex = rows.findIndex((row) => readKey(row) === nextKey);
    if (existingIndex < 0) return [...rows, next];
    const copy = rows.slice();
    copy[existingIndex] = next;
    return copy;
}

export const isManagedLocalPet = (pet: ImportedLocalPetPackageV1 | DiscoveredPetPackageV1): pet is ManagedLocalPet =>
    pet.kind === 'happierManagedLocal';
export const isDetectedPet = (pet: DiscoveredPetPackageV1): pet is DetectedPet => pet.kind === 'detectedCodexHome';

export function buildImportPayload(
    candidate: DiscoveredPetPackageV1 | null,
): Pick<DaemonPetImportLocalPackageRequestV1, 'sourceKey'> | null {
    if (!candidate) return null;
    if (candidate.sourceKey) return { sourceKey: candidate.sourceKey };
    return null;
}

export function localPetMetadataToRow(source: LocalPetSourceMetadata): LocalDevicePetRow | null {
    if (source.kind !== 'happierManagedLocal') return null;
    return {
        sourceKey: source.sourceKey,
        petId: source.petId,
        displayName: source.displayName,
        source: {
            kind: 'happierManagedLocal',
            sourceKey: source.sourceKey,
            mediaType: source.mediaType,
            digest: source.digest,
            daemonTarget: source.daemonTarget,
        },
    };
}

/** This device's library spans the relay's machines: each pet keeps the machine that serves it. */
export function localPetSourceIsOnServer(source: LocalPetSourceMetadata, serverId: string): boolean {
    return !serverId || source.daemonTarget.serverId === serverId;
}

/** The machine Settings detects and imports pets on: this computer in the desktop app, else the first online machine. */
export function resolvePetTargetMachineId(
    machines: ReadonlyArray<Readonly<{ id: string; active: boolean }>>,
    thisComputerMachineId: string | null,
): string {
    if (thisComputerMachineId && machines.some((machine) => machine.id === thisComputerMachineId)) {
        return thisComputerMachineId;
    }
    return machines.find((machine) => machine.active)?.id ?? machines[0]?.id ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object';
}

function readStringField(value: unknown, field: string): string | null {
    if (!isRecord(value)) return null;
    const fieldValue = value[field];
    return typeof fieldValue === 'string' ? fieldValue : null;
}

export function isRpcMethodNotAvailableError(value: unknown): boolean {
    const directCode = readStringField(value, 'errorCode') ?? readStringField(value, 'code');
    if (directCode === 'RPC_METHOD_NOT_AVAILABLE') return true;
    const directMessage = readStringField(value, 'message') ?? readStringField(value, 'error');
    if (directMessage?.includes('RPC_METHOD_NOT_AVAILABLE')) return true;
    if (directMessage?.toLowerCase().includes('rpc method not available')) return true;
    if (!isRecord(value)) return false;
    return isRpcMethodNotAvailableError(value.cause)
        || isRpcMethodNotAvailableError(value.payload)
        || isRpcMethodNotAvailableError(value.response);
}
