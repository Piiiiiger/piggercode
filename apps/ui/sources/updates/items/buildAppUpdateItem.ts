import type { AppPackageUpdates } from '@/updates/appPackageUpdater';
import type { PackageUpdaterSnapshot } from '@/updates/packageUpdater';

import { buildUpdateItemId, type UpdateItem } from './updateItem';

/** Which owner the "This app" row speaks for, and so which one its action runs. */
export type AppUpdateChannel = 'package' | 'native-store' | 'web-ui' | 'ota' | 'none';

export type AppUpdateFacts = Readonly<{
    platformOs: string;
    /** The package update this app has (`updates/appPackageUpdater.ts`). */
    packageUpdates: AppPackageUpdates;
    title: string;
    native: Readonly<{ updateUrl: string | null; required: boolean }>;
    webUiUpdateAvailable: boolean;
    packageUpdate: PackageUpdaterSnapshot;
    ota: Readonly<{ isDownloading: boolean; downloadProgress: number | null; isUpdatePending: boolean }>;
}>;

export type AppUpdateItemModel = Readonly<{ channel: AppUpdateChannel; item: UpdateItem }>;

const BASE: Omit<UpdateItem, 'title'> = {
    id: buildUpdateItemId('app', { kind: 'app' }),
    subject: { kind: 'app' },
    machineId: null,
    currentVersion: null,
    latestVersion: null,
    state: 'upToDate',
    progressPercent: null,
    step: null,
    managedBy: 'happier',
    action: { kind: 'none' },
    failure: null,
    skipped: false,
};

function wholePercent(fraction: number | null): number | null {
    if (fraction == null || !Number.isFinite(fraction)) return null;
    return Math.max(0, Math.min(100, Math.floor(fraction * 100)));
}

/**
 * The desktop app installs its downloaded update by restarting; the Android app hands the APK to Android's
 * installer.
 */
function buildPackageItem(base: UpdateItem, update: PackageUpdaterSnapshot, packageUpdates: AppPackageUpdates): UpdateItem {
    const versions = { currentVersion: update.currentVersion, latestVersion: update.version, skipped: update.skipped };
    const viaInstaller = packageUpdates === 'android';
    switch (update.phase) {
        case 'checking':
            return { ...base, state: 'checking' };
        case 'upToDate':
            return { ...base, currentVersion: update.currentVersion, state: 'upToDate' };
        case 'available':
            return { ...base, ...versions, state: 'available', action: { kind: 'run', verb: 'update' } };
        case 'downloading':
            return { ...base, ...versions, state: 'running', step: 'downloading', progressPercent: update.downloadPercent };
        case 'ready':
            return { ...base, ...versions, state: 'ready', action: { kind: 'run', verb: viaInstaller ? 'install' : 'restart' } };
        case 'installing':
            return { ...base, ...versions, state: 'running', step: viaInstaller ? 'installing' : 'restarting' };
        case 'failed':
            if (update.failure === 'check') {
                // No answer yet is not "up to date": the row says it could not check, with Retry.
                return { ...base, ...versions, state: 'unknown', failure: { kind: 'appCheck' }, action: { kind: 'run', verb: 'retry' } };
            }
            return {
                ...base,
                ...versions,
                state: 'failed',
                failure: update.failure === 'install' ? { kind: 'appInstall' } : { kind: 'appDownload' },
                action: { kind: 'run', verb: 'retry' },
            };
        case 'idle':
            return { ...base, state: 'unchecked' };
    }
}

/**
 * The "This app" row (R13 (e)): one classification over the app's update owners, in the order they
 * can apply — a required store update, a store update, a newer web build, the package updater, an
 * OTA bundle. Release notes are not updates and are not an input. "The package updater" is the desktop
 * app's or the Android app's own (`packageUpdates`).
 */
export function buildAppUpdateItem(facts: AppUpdateFacts): AppUpdateItemModel {
    const base: UpdateItem = { ...BASE, title: facts.title };

    if (facts.native.required) {
        return {
            channel: 'native-store',
            item: { ...base, state: 'required', action: facts.native.updateUrl ? { kind: 'run', verb: 'store' } : { kind: 'none' } },
        };
    }
    if (facts.native.updateUrl) {
        return { channel: 'native-store', item: { ...base, state: 'available', action: { kind: 'run', verb: 'store' } } };
    }
    if (facts.platformOs === 'web' && facts.webUiUpdateAvailable) {
        return { channel: 'web-ui', item: { ...base, state: 'available', action: { kind: 'run', verb: 'reload' } } };
    }
    if (facts.packageUpdates !== null || facts.packageUpdate.phase !== 'idle') {
        return { channel: 'package', item: buildPackageItem(base, facts.packageUpdate, facts.packageUpdates) };
    }
    if (facts.ota.isDownloading) {
        return {
            channel: 'ota',
            item: { ...base, state: 'running', step: 'downloading', progressPercent: wholePercent(facts.ota.downloadProgress) },
        };
    }
    if (facts.ota.isUpdatePending) {
        return { channel: 'ota', item: { ...base, state: 'ready', action: { kind: 'run', verb: 'restart' } } };
    }
    return { channel: 'none', item: base };
}
