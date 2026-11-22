import * as React from 'react';

import {
    resolveSelectedPetPackage,
    type ResolveSelectedPetPackageResult,
    type SelectedPetPackageSource,
} from '@/components/pets/source/resolveSelectedPetPackage';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { storage, useLocalSetting, useSetting } from '@/sync/domains/state/storage';

export function useSelectedPetPackage(): ResolveSelectedPetPackageResult {
    const petsEnabled = useSetting('petsEnabled');
    const petsSelectedPetRef = useSetting('petsSelectedPetRef');
    const petsEnabledOverride = useLocalSetting('petsEnabledOverride');
    const petsSelectedPetOverride = useLocalSetting('petsSelectedPetOverride');
    const accountPetsById = storage((state) => state.accountPetsById);
    const localPetSourcesBySourceKey = storage((state) => state.localPetSourcesBySourceKey);
    const companionDecision = useFeatureDecision('pets.companion');
    const syncDecision = useFeatureDecision('pets.sync');

    return React.useMemo(() => {
        const accountPetSources = new Map<string, SelectedPetPackageSource>(
            Object.values(accountPetsById).map((pet) => [
                pet.accountPetId,
                {
                    kind: 'accountPet' as const,
                    accountPetId: pet.accountPetId,
                    sourceKey: pet.accountPetId,
                    mediaType: pet.spritesheetAssetRef.mediaType,
                    digest: pet.spritesheetAssetRef.digest,
                },
            ]),
        );
        const happierManagedLocalBySourceKey = new Map<string, SelectedPetPackageSource>();
        for (const source of Object.values(localPetSourcesBySourceKey)) {
            if (source.kind !== 'happierManagedLocal') continue;
            const entry = {
                kind: source.kind,
                sourceKey: source.sourceKey,
                mediaType: source.mediaType,
                digest: source.digest,
                daemonTarget: source.daemonTarget,
            };
            happierManagedLocalBySourceKey.set(source.sourceKey, entry);
        }

        return resolveSelectedPetPackage({
            companionDecision,
            syncDecision,
            accountSettings: {
                petsEnabled,
                petsSelectedPetRef,
            },
            localSettings: {
                petsEnabledOverride,
                petsSelectedPetOverride,
            },
            sources: {
                accountPetsById: accountPetSources,
                happierManagedLocalBySourceKey,
            },
        });
    }, [
        accountPetsById,
        companionDecision,
        localPetSourcesBySourceKey,
        petsEnabled,
        petsEnabledOverride,
        petsSelectedPetOverride,
        petsSelectedPetRef,
        syncDecision,
    ]);
}
