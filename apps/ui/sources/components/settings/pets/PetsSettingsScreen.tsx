import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import {
    DaemonPetDiscoverResponseV1Schema,
    DaemonPetForgetLocalPackageResponseV1Schema,
    DaemonPetImportLocalPackageResponseV1Schema,
    DaemonPetImportResponseV1Schema,
    PET_DAEMON_RPC_METHODS,
    ImportedLocalPetPackageV1Schema,
    type AccountPetLibraryEntryV1,
    type DaemonPetDiscoverRequestV1,
    type DaemonPetForgetLocalPackageRequestV1,
    type DaemonPetImportAccountPackageRequestV1,
    type DaemonPetImportLocalPackageRequestV1,
    type DiscoveredPetPackageV1,
} from '@piggercode/protocol';

import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { resetDesktopPetOverlayPosition } from '@/components/pets/desktop/bridge/desktopPetOverlayBridge';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { t } from '@/text';
import {
    createLocalPetSourceMetadata,
    type LocalPetDaemonTarget,
    type LocalPetSourceMetadata,
} from '@/sync/domains/pets/localPetSourceMetadata';
import { storage, useAllMachines, useLocalSettings, useSettings } from '@/sync/domains/state/storage';
import { useThisComputerMachineId } from '@/setup/useThisComputerMachineId';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { useApplyLocalSettings, useApplySettings } from '@/sync/store/settingsWriters';
import { isTauriDesktop } from '@/utils/platform/tauri';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { PetsAccountLibrarySection } from './petsSettingsScreen/PetsAccountLibrarySection';
import { PetsAccountSettingsSection } from './petsSettingsScreen/PetsAccountSettingsSection';
import { PetsDesktopOverlaySettingsSection } from './petsSettingsScreen/PetsDesktopOverlaySettingsSection';
import { PetsLocalLibrarySection } from './petsSettingsScreen/PetsLocalLibrarySection';
import {
    buildImportPayload,
    isDetectedPet,
    isManagedLocalPet,
    isRpcMethodNotAvailableError,
    localPetMetadataToRow,
    localPetSourceIsOnServer,
    resolvePetTargetMachineId,
    upsertByKey,
} from './petsSettingsScreen/helpers';
import { usePetSourceActionRows } from './petsSettingsScreen/usePetSourceActionRows';
import { Icon } from '@/components/ui/icons/Icon';
import {
    consumePendingCodexPetRefresh,
    subscribeCodexPetRefresh,
} from './petSettingsCommandEvents';
import type {
    CodexDetectionState,
    DetectedPet,
    LocalPetImportDiagnostic,
    LocalPetRemovalDiagnostic,
    LocalDevicePetRow,
} from './petsSettingsScreen/types';

/** What the last detection found and the machine that found it: its previews and imports go back to that machine. */
type PetDiscovery = Readonly<{
    pets: readonly DiscoveredPetPackageV1[];
    target: LocalPetDaemonTarget | null;
}>;

const NO_PET_DISCOVERY: PetDiscovery = { pets: [], target: null };

/** What this screen detected and imported belongs to the relay it ran on: another relay starts it afresh. */
export function PetsSettingsScreen() {
    const activeServerSnapshot = useActiveServerSnapshot();
    return <RelayPetsSettings key={String(activeServerSnapshot.serverId ?? '')} />;
}

function RelayPetsSettings() {
    const { theme } = useUnistyles();
    const settings = useSettings();
    const localSettings = useLocalSettings();
    const machines = useAllMachines();
    const activeServerSnapshot = useActiveServerSnapshot();
    const accountPetsById = storage((state) => state.accountPetsById);
    const localPetSourcesBySourceKey = storage((state) => state.localPetSourcesBySourceKey);
    const applySettings = useApplySettings();
    const applyLocalSettings = useApplyLocalSettings();
    const companionDecision = useFeatureDecision('pets.companion');
    const companionEnabled = companionDecision?.state === 'enabled';
    const companionDisabledByServer = companionDecision?.state === 'disabled'
        && companionDecision.blockedBy === 'server';
    const syncEnabled = useFeatureEnabled('pets.sync');
    const [deviceOverrideOpen, setDeviceOverrideOpen] = React.useState(false);
    const [desktopOverlayOverrideOpen, setDesktopOverlayOverrideOpen] = React.useState(false);
    const [desktopOverlayVisibilityModeOpen, setDesktopOverlayVisibilityModeOpen] = React.useState(false);
    const [codexDetectionState, setCodexDetectionState] = React.useState<CodexDetectionState>('idle');
    const [discovery, setDiscovery] = React.useState<PetDiscovery>(NO_PET_DISCOVERY);
    const [importedLocalPets, setImportedLocalPets] = React.useState<LocalPetSourceMetadata[]>([]);
    const [importedAccountPets, setImportedAccountPets] = React.useState<AccountPetLibraryEntryV1[]>([]);
    const [localImportDiagnostic, setLocalImportDiagnostic] = React.useState<LocalPetImportDiagnostic | null>(null);
    const [localRemovalDiagnostic, setLocalRemovalDiagnostic] = React.useState<LocalPetRemovalDiagnostic | null>(null);
    const importingLocalPetKeysRef = React.useRef(new Set<string>());
    const importingAccountPetKeysRef = React.useRef(new Set<string>());
    const removingLocalPetSourceKeysRef = React.useRef(new Set<string>());
    const showDesktopOverlaySettings = isTauriDesktop();

    const thisComputerMachineId = useThisComputerMachineId();
    const targetMachineId = resolvePetTargetMachineId(machines, thisComputerMachineId);
    const targetServerId = String(activeServerSnapshot.serverId ?? '').trim();

    const overrideItems: DropdownMenuItem[] = [
        { id: 'inherit', title: t('settingsPets.overrideInherit') },
        { id: 'enabled', title: t('settingsPets.overrideEnabled') },
        { id: 'disabled', title: t('settingsPets.overrideDisabled') },
    ];
    const visibilityModeItems: DropdownMenuItem[] = [
        { id: 'inherit', title: t('settingsPets.visibilityModeInherit') },
        { id: 'alwaysWhenEnabled', title: t('settingsPets.visibilityModeAlwaysWhenEnabled') },
        { id: 'attentionOrActive', title: t('settingsPets.visibilityModeAttentionOrActive') },
        { id: 'attentionOnly', title: t('settingsPets.visibilityModeAttentionOnly') },
    ];

    const localPetRows = React.useMemo((): LocalDevicePetRow[] => {
        const rows = new Map<string, LocalDevicePetRow>();
        for (const source of Object.values(localPetSourcesBySourceKey)) {
            if (!localPetSourceIsOnServer(source, targetServerId)) continue;
            const row = localPetMetadataToRow(source);
            if (row) rows.set(row.sourceKey, row);
        }
        for (const pet of discovery.pets) {
            if (!isManagedLocalPet(pet) || !discovery.target) continue;
            const metadata = createLocalPetSourceMetadata(pet, discovery.target);
            const row = metadata ? localPetMetadataToRow(metadata) : null;
            if (row) rows.set(row.sourceKey, row);
        }
        for (const metadata of importedLocalPets) {
            const row = localPetMetadataToRow(metadata);
            if (row) rows.set(row.sourceKey, row);
        }
        return Array.from(rows.values());
    }, [discovery, importedLocalPets, localPetSourcesBySourceKey, targetServerId]);

    const detectedPetRows = React.useMemo(
        () => discovery.pets.filter(isDetectedPet),
        [discovery.pets],
    );

    const accountPets = React.useMemo(() => {
        const byId = new Map<string, AccountPetLibraryEntryV1>();
        for (const pet of Object.values(accountPetsById)) byId.set(pet.accountPetId, pet);
        for (const pet of importedAccountPets) byId.set(pet.accountPetId, pet);
        return Array.from(byId.values());
    }, [accountPetsById, importedAccountPets]);

    const discoverPets = React.useCallback(async () => {
        if (codexDetectionState === 'loading') return;
        if (!targetMachineId || !targetServerId) {
            setCodexDetectionState('noTarget');
            return;
        }
        setCodexDetectionState('loading');
        try {
            const payload: DaemonPetDiscoverRequestV1 = {
                includeDetectedCodexHomes: true,
                includeUserCodexHome: true,
                includeConnectedServiceCodexHomes: true,
                includeManagedLocal: true,
            };
            const raw = await machineRpcWithServerScope<unknown, DaemonPetDiscoverRequestV1>({
                machineId: targetMachineId,
                serverId: targetServerId,
                method: PET_DAEMON_RPC_METHODS.DISCOVER_PACKAGES,
                payload,
            });
            if (isRpcMethodNotAvailableError(raw)) {
                setDiscovery(NO_PET_DISCOVERY);
                setCodexDetectionState('daemonMismatch');
                return;
            }
            const parsed = DaemonPetDiscoverResponseV1Schema.parse(raw);
            if (parsed.ok) {
                const target = { machineId: targetMachineId, serverId: targetServerId };
                for (const pet of parsed.pets) {
                    const metadata = createLocalPetSourceMetadata(pet, target);
                    if (metadata) storage.getState().upsertLocalPetSource(metadata);
                }
                setDiscovery({ pets: parsed.pets, target });
                setCodexDetectionState(parsed.pets.some(isDetectedPet) ? 'success' : 'empty');
            } else {
                setDiscovery(NO_PET_DISCOVERY);
                setCodexDetectionState('error');
            }
        } catch (error) {
            setDiscovery(NO_PET_DISCOVERY);
            setCodexDetectionState(isRpcMethodNotAvailableError(error) ? 'daemonMismatch' : 'error');
        }
    }, [codexDetectionState, targetMachineId, targetServerId]);

    React.useEffect(() => {
        const runPendingRefresh = () => {
            if (!consumePendingCodexPetRefresh()) return;
            void discoverPets();
        };
        runPendingRefresh();
        return subscribeCodexPetRefresh(runPendingRefresh);
    }, [discoverPets]);

    const importLocalPet = React.useCallback(async (candidate: DiscoveredPetPackageV1) => {
        const target = discovery.target;
        if (!target) return;
        const payload = buildImportPayload(candidate);
        if (!payload) return;
        const importKey = payload.sourceKey;
        if (importingLocalPetKeysRef.current.has(importKey)) return;
        importingLocalPetKeysRef.current.add(importKey);
        setLocalImportDiagnostic(null);
        try {
            const raw = await machineRpcWithServerScope<unknown, DaemonPetImportLocalPackageRequestV1>({
                machineId: target.machineId,
                serverId: target.serverId,
                method: PET_DAEMON_RPC_METHODS.IMPORT_LOCAL_PACKAGE,
                payload,
            });
            const parsed = DaemonPetImportLocalPackageResponseV1Schema.parse(raw);
            if ('ok' in parsed && parsed.ok === false) {
                setLocalImportDiagnostic({
                    code: typeof parsed.errorCode === 'string' ? parsed.errorCode : 'daemon_import_failed',
                });
                return;
            }
            const importedPetResult = ImportedLocalPetPackageV1Schema.safeParse(parsed.importedPet);
            if (!importedPetResult.success || importedPetResult.data.kind !== 'happierManagedLocal') {
                setLocalImportDiagnostic({ code: 'invalid_response' });
                return;
            }
            const importedPet = importedPetResult.data;
            const metadata = createLocalPetSourceMetadata(importedPet, target);
            if (metadata) {
                storage.getState().upsertLocalPetSource(metadata);
                setImportedLocalPets((pets) => upsertByKey(pets, metadata, (pet) => pet.sourceKey));
            }
            applyLocalSettings({
                petsSelectedPetOverride: {
                    kind: 'happierManagedLocal',
                    sourceKey: importedPet.sourceKey,
                },
            });
        } catch {
            setLocalImportDiagnostic({ code: 'daemon_import_failed' });
            setImportedLocalPets((pets) => pets);
        } finally {
            importingLocalPetKeysRef.current.delete(importKey);
        }
    }, [applyLocalSettings, discovery.target]);

    const importAccountPet = React.useCallback(async (candidate: DiscoveredPetPackageV1) => {
        const target = discovery.target;
        if (!syncEnabled || !target) return;
        const importPayload = buildImportPayload(candidate);
        if (!importPayload) return;
        const importKey = importPayload.sourceKey;
        if (importingAccountPetKeysRef.current.has(importKey)) return;
        importingAccountPetKeysRef.current.add(importKey);
        try {
            const payload: DaemonPetImportAccountPackageRequestV1 = {
                ...importPayload,
                petsSyncEnabled: true,
            };
            const raw = await machineRpcWithServerScope<unknown, DaemonPetImportAccountPackageRequestV1>({
                machineId: target.machineId,
                serverId: target.serverId,
                method: PET_DAEMON_RPC_METHODS.IMPORT_ACCOUNT_PACKAGE,
                payload,
            });
            const parsed = DaemonPetImportResponseV1Schema.parse(raw);
            if (!parsed.ok || parsed.target !== 'account' || !parsed.account.ok) return;
            const pet = parsed.account.pet;
            storage.getState().upsertAccountPet(pet);
            setImportedAccountPets((pets) => upsertByKey(pets, pet, (entry) => entry.accountPetId));
            applySettings({
                petsSelectedPetRef: { kind: 'accountPet', accountPetId: pet.accountPetId },
            });
        } catch {
            setImportedAccountPets((pets) => pets);
        } finally {
            importingAccountPetKeysRef.current.delete(importKey);
        }
    }, [applySettings, discovery.target, syncEnabled]);

    const removeLocalPet = React.useCallback(async (pet: LocalDevicePetRow) => {
        if (removingLocalPetSourceKeysRef.current.has(pet.sourceKey)) return;
        removingLocalPetSourceKeysRef.current.add(pet.sourceKey);
        setLocalRemovalDiagnostic(null);
        try {
            // The machine that holds this pet, while the relay still lists it.
            const holder = pet.source.daemonTarget;
            if (holder && machines.some((machine) => machine.id === holder.machineId)) {
                const payload: DaemonPetForgetLocalPackageRequestV1 = { sourceKey: pet.sourceKey };
                const raw = await machineRpcWithServerScope<unknown, DaemonPetForgetLocalPackageRequestV1>({
                    machineId: holder.machineId,
                    serverId: holder.serverId,
                    method: PET_DAEMON_RPC_METHODS.FORGET_LOCAL_PACKAGE,
                    payload,
                });
                const parsed = DaemonPetForgetLocalPackageResponseV1Schema.safeParse(raw);
                if (!parsed.success || ('ok' in parsed.data && parsed.data.ok === false)) {
                    setLocalRemovalDiagnostic({ code: 'daemon_forget_failed' });
                }
            } else {
                setLocalRemovalDiagnostic({ code: 'daemon_unavailable' });
            }
        } catch {
            setLocalRemovalDiagnostic({ code: 'daemon_forget_failed' });
        } finally {
            removingLocalPetSourceKeysRef.current.delete(pet.sourceKey);
        }

        storage.getState().removeLocalPetSource(pet.sourceKey);
        setImportedLocalPets((pets) => pets.filter((candidate) => candidate.sourceKey !== pet.sourceKey));
        setDiscovery((current) => ({
            ...current,
            pets: current.pets.filter((candidate) => candidate.sourceKey !== pet.sourceKey),
        }));
        // Read now, from the store: another pet may have been chosen while the daemon answered, also on another relay's
        // screen after this one unmounted.
        const selectedPet = storage.getState().localSettings.petsSelectedPetOverride;
        if (selectedPet.kind === 'happierManagedLocal' && selectedPet.sourceKey === pet.sourceKey) {
            applyLocalSettings({ petsSelectedPetOverride: { kind: 'inherit' } });
        }
    }, [applyLocalSettings, machines]);

    const handleSelectAccountPet = React.useCallback((accountPetId: string) => {
        applySettings({
            petsSelectedPetRef: {
                kind: 'accountPet',
                accountPetId,
            },
        });
        if (localSettings.petsSelectedPetOverride.kind !== 'inherit') {
            applyLocalSettings({ petsSelectedPetOverride: { kind: 'inherit' } });
        }
    }, [applyLocalSettings, applySettings, localSettings.petsSelectedPetOverride.kind]);

    const handleResetDesktopPetOverlayPosition = React.useCallback(() => {
        applyLocalSettings({
            desktopPetOverlayOffset: { x: 0, y: 0 },
            desktopPetOverlayAnchor: 'bottomRight',
        });
        fireAndForget(resetDesktopPetOverlayPosition(), {
            tag: 'PetsSettingsScreen.resetDesktopPetOverlayPosition',
        });
    }, [applyLocalSettings]);

    const { detectedPetTileRows, localSelectorRows } = usePetSourceActionRows({
        applyLocalSettings,
        detectedPetRows,
        importAccountPet,
        importLocalPet,
        localPetRows,
        petsSelectedPetOverride: localSettings.petsSelectedPetOverride,
        removeLocalPet,
        syncEnabled,
        detectionTarget: discovery.target,
    });

    if (!companionEnabled) {
        return (
            <ItemList style={{ paddingTop: 0 }}>
                <ItemGroup>
                    <Item
                        testID="settings-pets-disabled"
                        title={t(companionDisabledByServer
                            ? 'settingsPets.disabledByServerTitle'
                            : 'settingsPets.disabledTitle')}
                        subtitle={t(companionDisabledByServer
                            ? 'settingsPets.disabledByServerSubtitle'
                            : 'settingsPets.disabledSubtitle')}
                        icon={<Icon name="paw-print" size={24} color={theme.colors.text.secondary} />}
                        mode="info"
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <PetsAccountSettingsSection
                companionSizeScale={localSettings.petsCompanionSizeScale}
                deviceOverrideOpen={deviceOverrideOpen}
                onDeviceOverrideOpenChange={setDeviceOverrideOpen}
                onCompanionSizeScaleChange={(value) => applyLocalSettings({ petsCompanionSizeScale: value })}
                onPetsEnabledChange={(value) => applySettings({ petsEnabled: value })}
                onPetsEnabledOverrideChange={(override) => applyLocalSettings({ petsEnabledOverride: override })}
                overrideItems={overrideItems}
                petsEnabled={settings.petsEnabled}
                petsEnabledOverride={localSettings.petsEnabledOverride}
            />

            <PetsLocalLibrarySection
                codexDetectionState={codexDetectionState}
                companionSizeScale={localSettings.petsCompanionSizeScale}
                detectedPetRowsCount={detectedPetRows.length}
                detectedPetTileRows={detectedPetTileRows}
                localPetRows={localSelectorRows}
                onDiscoverPets={discoverPets}
                importDiagnostic={localImportDiagnostic}
                removalDiagnostic={localRemovalDiagnostic}
            />

            {syncEnabled ? (
                <PetsAccountLibrarySection
                    accountPets={accountPets}
                    companionSizeScale={localSettings.petsCompanionSizeScale}
                    onSelectAccountPet={handleSelectAccountPet}
                    selectedAccountPetId={
                        settings.petsSelectedPetRef.kind === 'accountPet'
                            ? settings.petsSelectedPetRef.accountPetId
                            : null
                    }
                />
            ) : null}

            {showDesktopOverlaySettings ? (
                <PetsDesktopOverlaySettingsSection
                    desktopOverlayDefaultEnabled={settings.petsDesktopOverlayDefaultEnabled}
                    desktopOverlayOverrideOpen={desktopOverlayOverrideOpen}
                    desktopOverlayVisibilityModeOpen={desktopOverlayVisibilityModeOpen}
                    desktopPetOverlayEnabledOverride={localSettings.desktopPetOverlayEnabledOverride}
                    desktopPetOverlayVisibilityModeOverride={localSettings.desktopPetOverlayVisibilityModeOverride}
                    onDefaultEnabledChange={(value) => applySettings({ petsDesktopOverlayDefaultEnabled: value })}
                    onDesktopOverlayOverrideChange={(override) => applyLocalSettings({ desktopPetOverlayEnabledOverride: override })}
                    onDesktopOverlayOverrideOpenChange={setDesktopOverlayOverrideOpen}
                    onDesktopOverlayVisibilityModeOverrideChange={(override) => applyLocalSettings({ desktopPetOverlayVisibilityModeOverride: override })}
                    onDesktopOverlayVisibilityModeOpenChange={setDesktopOverlayVisibilityModeOpen}
                    onResetPosition={handleResetDesktopPetOverlayPosition}
                    overrideItems={overrideItems}
                    visibilityModeItems={visibilityModeItems}
                />
            ) : null}
        </ItemList>
    );
}

export default React.memo(PetsSettingsScreen);
