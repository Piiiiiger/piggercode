import { createPackageUpdaterStore, type PackageUpdaterStore } from '@/updates/packageUpdater';

/**
 * Only the Android app updates itself from an APK (`androidApkUpdater.android.ts`, which Metro takes for Android
 * builds). Elsewhere this store stays idle and loads none of Android's native modules.
 */
export const androidApkUpdater: PackageUpdaterStore = createPackageUpdaterStore({
    enabled: () => false,
    fetchUpdate: async () => null,
    download: async () => false,
    install: async () => 'nothing',
    onReturn: () => {},
    skippedVersion: { read: () => null, write: () => {} },
});
