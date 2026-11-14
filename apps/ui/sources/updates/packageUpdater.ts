import * as React from 'react';

import { isLatestVersionCheckDue } from '@/updates/latestVersionCheckFreshness';

/**
 * The app's own package update, one owner for every surface (R13 (e), S-3): the desktop app's
 * (`desktop/updates/desktopUpdater.ts`, Tauri's updater) and the Android app's APK
 * (`updates/android/androidApkUpdater.android.ts`) run this one lifecycle over a platform adapter.
 * Every surface — the sidebar pill, the Updates screen, Settings, the tray — subscribes to the store;
 * none of them checks, downloads or installs on its own, so there is one network check, one pending
 * update and one answer everybody agrees on.
 *
 * Lifecycle: `idle` (not a build that updates itself, or checks disabled) → `checking` (the first
 * check only; later checks keep the last answer on screen) → `available` | `upToDate` | `failed` →
 * `downloading` (a real percentage when the size is known) → `ready` → `installing` (the desktop app
 * restarts; Android shows its installer, and comes back to `ready` when that closes). `failed` names
 * the step (`check`, `download`, `install`); the raw platform message is never part of the snapshot.
 *
 * Checks run at launch and when the person comes back to the app (window focus, app in the
 * foreground) once the last answer is due, through the shared latest-version freshness policy — no
 * poll loop of its own.
 */
export type PackageUpdaterPhase =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'upToDate'
    | 'failed';

export type PackageUpdaterFailure = 'check' | 'download' | 'install';

export type PackageUpdaterSnapshot = Readonly<{
    phase: PackageUpdaterPhase;
    /** The version on offer (kept through download, ready and a failed download/install). */
    version: string | null;
    currentVersion: string | null;
    /** Whole percent while downloading with a known length; `null` means indeterminate. */
    downloadPercent: number | null;
    failure: PackageUpdaterFailure | null;
    /** The person chose "Skip this version" for exactly this offered version. */
    skipped: boolean;
    /** A re-check is in flight behind a settled answer. */
    refreshing: boolean;
    /** When the last check settled successfully (ms), for "Checked 2 hours ago". */
    checkedAt: number | null;
}>;

export type PackageUpdaterStore = Readonly<{
    getSnapshot: () => PackageUpdaterSnapshot;
    subscribe: (listener: () => void) => () => void;
    /** `force` is the explicit "Check for updates"; otherwise only when the answer is due. */
    check: (options?: Readonly<{ force?: boolean }>) => Promise<void>;
    download: () => Promise<void>;
    /** Installs the downloaded update: the desktop app restarts, Android shows its installer. */
    install: () => Promise<void>;
    /** Repeats the step that failed. */
    retry: () => Promise<void>;
    skipVersion: () => void;
}>;

/** A newer version than the running one, as the platform's update source offers it. */
export type PackageUpdateOffer = Readonly<{
    version: string;
    currentVersion: string;
    /** This version is already downloaded (e.g. before the app was reopened). */
    downloaded?: boolean;
}>;

/** What one platform does for the lifecycle above. */
export type PackageUpdateAdapter = Readonly<{
    /** Whether this build updates itself this way (decided once). */
    enabled: () => boolean;
    /** The newer version on offer, or null when the running one is current; throws when it could not tell. */
    fetchUpdate: () => Promise<PackageUpdateOffer | null>;
    /** Downloads the offered version; false when the offer is gone (the store asks again). Throws on failure. */
    download: (version: string, onProgress: (percent: number | null) => void) => Promise<boolean>;
    /**
     * Installs the downloaded version: `restarting` (the app is being replaced), `returned` (the
     * system's installer closed and this app still runs), `nothing` (no update was downloaded).
     */
    install: () => Promise<'restarting' | 'returned' | 'nothing'>;
    /** Calls back each time the person comes back to the app. */
    onReturn: (listener: () => void) => void;
    /** Remembers "Skip this version" across launches. */
    skippedVersion: Readonly<{ read: () => string | null; write: (version: string) => void }>;
}>;

const IDLE: PackageUpdaterSnapshot = {
    phase: 'idle',
    version: null,
    currentVersion: null,
    downloadPercent: null,
    failure: null,
    skipped: false,
    refreshing: false,
    checkedAt: null,
};

export function createPackageUpdaterStore(adapter: PackageUpdateAdapter): PackageUpdaterStore {
    let snapshot: PackageUpdaterSnapshot = IDLE;
    let enabled: boolean | null = null;
    let started = false;
    let checkInFlight: Promise<void> | null = null;
    let actionInFlight: Promise<void> | null = null;
    let lastAttemptAt: number | null = null;
    let lastAttemptOk = false;
    const listeners = new Set<() => void>();

    const publish = (next: PackageUpdaterSnapshot) => {
        if (next === snapshot) return;
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const patch = (partial: Partial<PackageUpdaterSnapshot>) => publish({ ...snapshot, ...partial });

    const isEnabled = () => {
        if (enabled === null) enabled = adapter.enabled();
        return enabled;
    };

    const isSkipped = (version: string | null) => version != null && adapter.skippedVersion.read() === version;

    const runCheck = async (): Promise<void> => {
        const hadAnswer = snapshot.phase !== 'idle' && snapshot.phase !== 'checking';
        patch(hadAnswer ? { refreshing: true } : { phase: 'checking' });
        try {
            const update = await adapter.fetchUpdate();
            lastAttemptAt = Date.now();
            lastAttemptOk = true;
            if (!update) {
                publish({ ...IDLE, phase: 'upToDate', checkedAt: lastAttemptAt });
                return;
            }
            // A running download or a ready package for the same version is not reset by a check.
            const sameVersion = update.version === snapshot.version;
            const keepPhase = sameVersion && (snapshot.phase === 'downloading' || snapshot.phase === 'ready' || snapshot.phase === 'installing');
            publish({
                ...snapshot,
                phase: update.downloaded === true ? 'ready' : keepPhase ? snapshot.phase : 'available',
                version: update.version,
                currentVersion: update.currentVersion,
                downloadPercent: keepPhase ? snapshot.downloadPercent : null,
                failure: null,
                skipped: isSkipped(update.version),
                refreshing: false,
                checkedAt: lastAttemptAt,
            });
        } catch {
            lastAttemptAt = Date.now();
            lastAttemptOk = false;
            // A background re-check that fails keeps the answer already on screen.
            if (hadAnswer && snapshot.phase !== 'failed') {
                patch({ refreshing: false });
                return;
            }
            publish({ ...snapshot, phase: 'failed', failure: 'check', refreshing: false });
        }
    };

    const check = (options?: Readonly<{ force?: boolean }>): Promise<void> => {
        if (!isEnabled()) return Promise.resolve();
        if (checkInFlight) return checkInFlight;
        if (actionInFlight) return Promise.resolve();
        if (options?.force !== true && lastAttemptAt != null
            && !isLatestVersionCheckDue({ checkedAt: lastAttemptAt, ok: lastAttemptOk, now: Date.now() })) {
            return Promise.resolve();
        }
        checkInFlight = runCheck().finally(() => {
            checkInFlight = null;
        });
        return checkInFlight;
    };

    const download = (): Promise<void> => {
        if (!isEnabled() || !snapshot.version || actionInFlight) return actionInFlight ?? Promise.resolve();
        const version = snapshot.version;
        patch({ phase: 'downloading', downloadPercent: null, failure: null });
        actionInFlight = (async () => {
            try {
                const downloaded = await adapter.download(version, (percent) => {
                    if (snapshot.phase !== 'downloading' || snapshot.version !== version) return;
                    if (percent !== snapshot.downloadPercent) patch({ downloadPercent: percent });
                });
                if (!downloaded) {
                    // The platform no longer holds an offer (e.g. the app was reloaded): ask again.
                    publish({ ...snapshot, phase: 'available', downloadPercent: null });
                    actionInFlight = null;
                    await check({ force: true });
                    return;
                }
                patch({ phase: 'ready', downloadPercent: null });
            } catch {
                patch({ phase: 'failed', failure: 'download', downloadPercent: null });
            }
        })().finally(() => {
            actionInFlight = null;
        });
        return actionInFlight;
    };

    const install = (): Promise<void> => {
        if (!isEnabled() || actionInFlight) return actionInFlight ?? Promise.resolve();
        patch({ phase: 'installing', failure: null });
        actionInFlight = (async () => {
            try {
                const result = await adapter.install();
                if (result === 'nothing') {
                    publish({ ...snapshot, phase: snapshot.version ? 'available' : 'upToDate' });
                } else if (result === 'returned') {
                    // The installer closed without replacing this app: the update stays ready to install.
                    patch({ phase: 'ready' });
                }
            } catch {
                patch({ phase: 'failed', failure: 'install' });
            }
        })().finally(() => {
            actionInFlight = null;
        });
        return actionInFlight;
    };

    const retry = (): Promise<void> => {
        if (snapshot.failure === 'install') return install();
        if (snapshot.failure === 'download') return download();
        return check({ force: true });
    };

    const skipVersion = () => {
        if (!snapshot.version) return;
        adapter.skippedVersion.write(snapshot.version);
        patch({ skipped: true });
    };

    const start = () => {
        if (started || !isEnabled()) return;
        started = true;
        adapter.onReturn(() => {
            void check();
        });
        void check();
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            start();
            return () => {
                listeners.delete(listener);
            };
        },
        check,
        download,
        install,
        retry,
        skipVersion,
    };
}

/**
 * Subscribes to a package updater. Mounting it any number of times never starts another check; the
 * store owns checking, downloading and installing.
 */
export function usePackageUpdater(store: PackageUpdaterStore): PackageUpdaterSnapshot {
    return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
