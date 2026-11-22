import type * as React from 'react';

import type { SelectedPetPackageSource } from '@/components/pets/source/resolveSelectedPetPackage';

export type LocalDevicePetSelectorItem = Readonly<{
    sourceKey: string;
    petId: string;
    displayName: string;
    selected: boolean;
    source: Extract<SelectedPetPackageSource, { kind: 'happierManagedLocal' }>;
    sourceTestID: string;
    actions: React.ReactNode;
    onPress: () => void;
}>;

export type DetectedDevicePetSelectorItem = Readonly<{
    sourceKey: string;
    petId: string;
    displayName: string;
    source: Extract<SelectedPetPackageSource, { kind: 'detectedCodexHome' }>;
    sourceTestID: string;
    previewTestID: string;
    actions: React.ReactNode;
    onPress?: () => void;
}>;

export type AccountDevicePetSelectorItem = Readonly<{
    accountPetId: string;
    petId: string;
    displayName: string;
    selected: boolean;
    source: Extract<SelectedPetPackageSource, { kind: 'accountPet' }>;
    sourceTestID: string;
    previewTestID: string;
    actions: React.ReactNode;
    onPress: () => void;
}>;

export type DevicePetSelectorProps = Readonly<{
    companionSizeScale?: number;
    localPets: readonly LocalDevicePetSelectorItem[];
    detectedPets?: readonly DetectedDevicePetSelectorItem[];
    accountPets?: readonly AccountDevicePetSelectorItem[];
    gridTestID?: string;
    contentsTestID?: string;
}>;

export type DevicePetTile = Readonly<
    | {
        kind: 'local';
        key: string;
        testID: string;
        pressableTestID: string;
        previewTestID: string;
        selectionControlTestID: string;
        petId: string;
        title: string;
        subtitle: string;
        selected: boolean;
        source: Extract<SelectedPetPackageSource, { kind: 'happierManagedLocal' }>;
        actions: React.ReactNode;
        onPress: () => void;
    }
    | {
        kind: 'account';
        key: string;
        testID: string;
        pressableTestID: string;
        previewTestID: string;
        selectionControlTestID: string;
        petId: string;
        title: string;
        subtitle: string;
        selected: boolean;
        source: Extract<SelectedPetPackageSource, { kind: 'accountPet' }>;
        actions: React.ReactNode;
        onPress: () => void;
    }
    | {
        kind: 'detected';
        key: string;
        testID: string;
        pressableTestID: string;
        previewTestID: string;
        petId: string;
        title: string;
        subtitle: string;
        selected: false;
        source: Extract<SelectedPetPackageSource, { kind: 'detectedCodexHome' }>;
        actions: React.ReactNode;
        onPress?: () => void;
    }
>;
