import { isDesktopPetOverlayWindowContext } from '@/components/pets/desktop/runtime/isDesktopPetOverlayWindowContext';
import { invokeTauri, isTauriDesktop, listenTauriEvent } from '@/utils/platform/tauri';
import { createPackageUpdaterStore, type PackageUpdateAdapter, type PackageUpdaterStore } from '@/updates/packageUpdater';

/**
 * The desktop app's update source for the shared package-update lifecycle (`updates/packageUpdater.ts`):
 * Tauri's updater in the Rust adapter (`desktop_fetch_update`, `desktop_download_update`,
 * `desktop_install_update`), which holds the one pending update for the main window. Checks run again
 * when the window regains focus.
 */
type UpdateMetadata = Readonly<{
    version: string;
    currentVersion: string;
    downloaded?: boolean;
}> | null;

type DownloadProgressPayload = Readonly<{ version?: unknown; downloadedBytes?: unknown; totalBytes?: unknown }>;

const DISMISS_KEY = 'desktop_update_dismissed_version';
const UPDATE_CHECKS_ENABLED_ENV = 'EXPO_PUBLIC_PIGGERCODE_DESKTOP_UPDATES_ENABLED';
export const DESKTOP_UPDATE_DOWNLOAD_PROGRESS_EVENT = 'desktop_update_download_progress';

function parseOptionalBoolean(raw: string | undefined): boolean | null {
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return null;
}

function resolveUpdateChecksEnabled(): boolean {
    if (!isTauriDesktop()) return false;
    // The pet overlay is a second webview of the same app; a check from it would replace the one
    // pending update the Rust adapter holds for the main window.
    if (isDesktopPetOverlayWindowContext()) return false;
    const override = parseOptionalBoolean(process.env[UPDATE_CHECKS_ENABLED_ENV]);
    if (override !== null) return override;
    return (globalThis as { __DEV__?: unknown }).__DEV__ !== true;
}

function readDismissedVersion(): string | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(DISMISS_KEY) : null;
    } catch {
        return null;
    }
}

function writeDismissedVersion(version: string): void {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, version);
    } catch {
        // Skipping stays in effect for this app open; it just is not remembered.
    }
}

function readWholePercent(payload: DownloadProgressPayload): number | null {
    const downloaded = typeof payload.downloadedBytes === 'number' ? payload.downloadedBytes : null;
    const total = typeof payload.totalBytes === 'number' ? payload.totalBytes : null;
    if (downloaded == null || total == null || total <= 0) return null;
    return Math.min(100, Math.floor((Math.min(downloaded, total) * 100) / total));
}

type FocusTarget = Readonly<{
    addEventListener?: (name: string, listener: () => void) => void;
}>;

const tauriPackageUpdates: PackageUpdateAdapter = {
    enabled: resolveUpdateChecksEnabled,
    fetchUpdate: () => invokeTauri<UpdateMetadata>('desktop_fetch_update'),
    download: async (version, onProgress) => {
        let unlisten: (() => void) | null = null;
        try {
            unlisten = await listenTauriEvent<DownloadProgressPayload>(DESKTOP_UPDATE_DOWNLOAD_PROGRESS_EVENT, (payload) => {
                if (payload.version !== version) return;
                onProgress(readWholePercent(payload));
            }).catch(() => null);
            return await invokeTauri<boolean>('desktop_download_update');
        } finally {
            unlisten?.();
        }
    },
    // Resolves only when there was nothing to install; otherwise the app restarts.
    install: async () => ((await invokeTauri<boolean>('desktop_install_update')) ? 'restarting' : 'nothing'),
    onReturn: (listener) => {
        const target = (typeof window !== 'undefined' ? window : undefined) as FocusTarget | undefined;
        target?.addEventListener?.('focus', listener);
    },
    skippedVersion: { read: readDismissedVersion, write: writeDismissedVersion },
};

export function createDesktopUpdaterStore(): PackageUpdaterStore {
    return createPackageUpdaterStore(tauriPackageUpdates);
}

/** The app's one desktop updater. */
export const desktopUpdater: PackageUpdaterStore = createDesktopUpdaterStore();
