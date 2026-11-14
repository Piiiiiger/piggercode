import { Platform } from 'react-native';

import { desktopUpdater } from '@/desktop/updates/desktopUpdater';
import { isTauriDesktop } from '@/utils/platform/tauri';

import { androidApkUpdater } from './android/androidApkUpdater';
import type { PackageUpdaterStore } from './packageUpdater';

/** Which package update this app has: the desktop app's, the Android app's APK, or none (web, iOS). */
export type AppPackageUpdates = 'desktop' | 'android' | null;

export function resolveAppPackageUpdates(): AppPackageUpdates {
    if (isTauriDesktop()) return 'desktop';
    return Platform.OS === 'android' ? 'android' : null;
}

/** This app's package updater; where the app does not update itself, an idle one. */
export function getAppPackageUpdater(): PackageUpdaterStore {
    return resolveAppPackageUpdates() === 'android' ? androidApkUpdater : desktopUpdater;
}
