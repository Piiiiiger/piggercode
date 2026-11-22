import { t } from '@/text';

import type {
    AccountDevicePetSelectorItem,
    DetectedDevicePetSelectorItem,
    DevicePetTile,
    LocalDevicePetSelectorItem,
} from './types';

type BuildDevicePetTilesParams = Readonly<{
    localPets: readonly LocalDevicePetSelectorItem[];
    detectedPets: readonly DetectedDevicePetSelectorItem[];
    accountPets: readonly AccountDevicePetSelectorItem[];
}>;

export function buildDevicePetTiles(params: BuildDevicePetTilesParams): DevicePetTile[] {
    return [
        ...params.localPets.map((pet): DevicePetTile => ({
            kind: 'local',
            key: `local:${pet.sourceKey}`,
            testID: `settings-pets-local-tile-${pet.sourceKey.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            pressableTestID: pet.sourceTestID,
            previewTestID: `settings-pets-local-preview-${pet.sourceKey.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            selectionControlTestID: `settings-pets-selection-control-${pet.sourceKey.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            petId: pet.petId,
            title: pet.displayName,
            subtitle: t('settingsPets.importedLocalSubtitle'),
            selected: pet.selected,
            source: pet.source,
            actions: pet.actions,
            onPress: pet.onPress,
        })),
        ...params.accountPets.map((pet): DevicePetTile => ({
            kind: 'account',
            key: `account:${pet.accountPetId}`,
            testID: `settings-pets-account-tile-${pet.accountPetId.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            pressableTestID: pet.sourceTestID,
            previewTestID: pet.previewTestID,
            selectionControlTestID: `settings-pets-selection-control-${pet.accountPetId.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            petId: pet.petId,
            title: pet.displayName,
            subtitle: t('settingsPets.accountPetTileSubtitle'),
            selected: pet.selected,
            source: pet.source,
            actions: pet.actions,
            onPress: pet.onPress,
        })),
        ...params.detectedPets.map((pet): DevicePetTile => ({
            kind: 'detected',
            key: `detected:${pet.sourceKey}`,
            testID: `settings-pets-detected-tile-${pet.sourceKey.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            pressableTestID: pet.sourceTestID,
            previewTestID: pet.previewTestID,
            petId: pet.petId,
            title: pet.displayName,
            subtitle: t('settingsPets.detectedCodexPetsTileSubtitle'),
            selected: false,
            source: pet.source,
            actions: pet.actions,
            onPress: pet.onPress,
        })),
    ];
}
