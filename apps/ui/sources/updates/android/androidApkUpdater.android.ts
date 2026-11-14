import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { AppState, Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';

import { createPackageUpdaterStore, type PackageUpdateAdapter, type PackageUpdaterStore } from '@/updates/packageUpdater';
import { compareVersionsOrNull } from '@/utils/system/versionUtils';

/**
 * The Android app's update source for the shared package-update lifecycle (`updates/packageUpdater.ts`): the APK
 * the Android workflow (`.github/workflows/android.yml`) puts on the `ui-android-stable` release, with a
 * `latest.json` beside it naming its version, address and size. The APK is downloaded into the app's cache and
 * handed to Android's installer, which updates the app in place (same package, same signing key, a higher
 * versionCode), keeping its data. Android installs nothing by itself for an app from outside a store: the person
 * confirms in the installer, and the first time allows PiggerCode to install apps.
 */
export const ANDROID_UPDATE_FEED_URL = 'https://github.com/Piiiiiger/piggercode/releases/download/ui-android-stable/latest.json';

/** Lets the installer read the APK through the app's file provider. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const APK_MIME_TYPE = 'application/vnd.android.package-archive';

type AndroidUpdateFeed = Readonly<{ version: string; url: string; size: number }>;

function readFeed(value: unknown): AndroidUpdateFeed | null {
    if (!value || typeof value !== 'object') return null;
    const feed = value as Record<string, unknown>;
    const { version, url, size } = feed;
    if (typeof version !== 'string' || typeof url !== 'string' || !url.startsWith('https://')) return null;
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return null;
    return { version, url, size };
}

const skippedVersions = new MMKV({ id: 'app-package-update' });
const SKIPPED_VERSION_KEY = 'skipped-version';

function createAndroidApkUpdates(): PackageUpdateAdapter {
    const updatesDir = `${FileSystem.cacheDirectory}app-updates/`;
    const apkPath = (version: string) => `${updatesDir}piggercode-${version}.apk`;
    /** The release behind the version on offer. */
    let offered: AndroidUpdateFeed | null = null;
    /** The file a running download writes into: a check that finishes meanwhile leaves it alone. */
    let downloadingTo: string | null = null;

    const isDownloaded = async (feed: AndroidUpdateFeed) => {
        const info = await FileSystem.getInfoAsync(apkPath(feed.version));
        return info.exists && !info.isDirectory && info.size === feed.size;
    };

    /** Downloads of other versions (an installed update's APK included) only take space. */
    const removeDownloadsExcept = async (keep: string | null) => {
        const dir = await FileSystem.getInfoAsync(updatesDir);
        if (!dir.exists) return;
        for (const name of await FileSystem.readDirectoryAsync(updatesDir)) {
            const path = `${updatesDir}${name}`;
            if (path !== keep && path !== downloadingTo) await FileSystem.deleteAsync(path, { idempotent: true });
        }
    };

    return {
        enabled: () => Platform.OS === 'android' && (globalThis as { __DEV__?: unknown }).__DEV__ !== true,
        fetchUpdate: async () => {
            // `no-store`: a fresh answer, not one a cache kept.
            const response = await fetch(ANDROID_UPDATE_FEED_URL, { cache: 'no-store' });
            if (!response.ok) throw new Error(`android update feed: HTTP ${response.status}`);
            const feed = readFeed(await response.json());
            const currentVersion = Application.nativeApplicationVersion;
            const newer = feed && currentVersion ? compareVersionsOrNull(feed.version, currentVersion) : null;
            if (!feed || !currentVersion || newer === null) throw new Error('android update feed: no comparable version');
            if (newer <= 0) {
                offered = null;
                await removeDownloadsExcept(null);
                return null;
            }
            offered = feed;
            await removeDownloadsExcept(apkPath(feed.version));
            return { version: feed.version, currentVersion, downloaded: await isDownloaded(feed) };
        },
        download: async (version, onProgress) => {
            const feed = offered;
            if (!feed || feed.version !== version) return false;
            await FileSystem.makeDirectoryAsync(updatesDir, { intermediates: true });
            const partial = `${apkPath(version)}.part`;
            downloadingTo = partial;
            try {
                const task = FileSystem.createDownloadResumable(feed.url, partial, {}, (progress) => {
                    const total = progress.totalBytesExpectedToWrite > 0 ? progress.totalBytesExpectedToWrite : feed.size;
                    onProgress(Math.min(100, Math.floor((progress.totalBytesWritten * 100) / total)));
                });
                const result = await task.downloadAsync();
                if (!result || result.status !== 200) throw new Error(`android update download: HTTP ${result?.status}`);
                const info = await FileSystem.getInfoAsync(partial);
                // A cut-off download: Android's installer would refuse it anyway.
                if (!info.exists || info.isDirectory || info.size !== feed.size) throw new Error('android update download: incomplete');
                await FileSystem.moveAsync({ from: partial, to: apkPath(version) });
                return true;
            } catch (error) {
                // Nothing of a failed download is kept (up to the APK's whole size); Retry starts it again.
                await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
                throw error;
            } finally {
                downloadingTo = null;
            }
        },
        install: async () => {
            const feed = offered;
            if (!feed || !(await isDownloaded(feed))) return 'nothing';
            const data = await FileSystem.getContentUriAsync(apkPath(feed.version));
            // Resolves when the installer closes; when it updated the app, this process is already gone.
            await startActivityAsync('android.intent.action.VIEW', {
                data,
                type: APK_MIME_TYPE,
                flags: FLAG_GRANT_READ_URI_PERMISSION,
            });
            return 'returned';
        },
        onReturn: (listener) => {
            AppState.addEventListener('change', (state) => {
                if (state === 'active') listener();
            });
        },
        skippedVersion: {
            read: () => skippedVersions.getString(SKIPPED_VERSION_KEY) ?? null,
            write: (version) => skippedVersions.set(SKIPPED_VERSION_KEY, version),
        },
    };
}

export function createAndroidApkUpdaterStore(): PackageUpdaterStore {
    return createPackageUpdaterStore(createAndroidApkUpdates());
}

/** The Android app's one updater. */
export const androidApkUpdater: PackageUpdaterStore = createAndroidApkUpdaterStore();
