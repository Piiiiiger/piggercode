import * as React from 'react';

import {
    getCachedMachineFileBrowserRoots,
    getMachineFileBrowserDirectoriesVersion,
    getMachineFileBrowserDirectoryState,
    listMachineFileBrowserDirectoryEntries,
    listMachineFileBrowserRoots,
    revalidateMachineFileBrowserDirectory,
    subscribeMachineFileBrowserDirectories,
    warmMachineFileBrowserDirectoryCache,
    warmMachineFileBrowserRoots,
} from '@/sync/domains/input/machineFileBrowser';
import type {
    SessionExplorerFolderRef,
    SessionExplorerListing,
    SessionExplorerMachineRef,
    SessionExplorerSharedFolder,
} from '@/sync/domains/session/listing/sessionListExplorer';
import { isHostVisible, startRuntimeActiveGatedInterval } from '@/utils/runtime/isRuntimeActive';
import { fireAndForget } from '@/utils/system/fireAndForget';

// The Sessions view lists folders only, the Files view folders and files; the machine file browser owns
// the cache (one per kind of listing), in-flight sharing and errors.
function directoryTarget(folder: SessionExplorerFolderRef) {
    return { machineId: folder.machineId, serverId: folder.serverId, directoryPath: folder.path, includeFiles: folder.includeFiles === true };
}

/** Whether a listing failed because the folder is not there (Node's ENOENT, as the machine passes it on). */
export function isMissingFolderListingError(error: string | null): boolean {
    return error !== null && /\bENOENT\b|no such file or directory/i.test(error);
}

/** A folder's subfolders (and files, for a Files listing) as the explorer shows them; null before it was ever listed. */
export function readExplorerListing(folder: SessionExplorerFolderRef): SessionExplorerListing | null {
    const state = getMachineFileBrowserDirectoryState(directoryTarget(folder));
    if (!state) return null;
    return {
        status: state.loading ? 'loading' : state.error !== null ? 'error' : 'loaded',
        dirs: state.entries ? state.entries.filter((entry) => entry.type === 'directory').map((entry) => entry.name) : null,
        files: state.entries ? state.entries.filter((entry) => entry.type === 'file').map((entry) => entry.name) : null,
        truncated: state.truncated,
        ...(isMissingFolderListingError(state.error) ? { missing: true } : {}),
    };
}

type ExplorerListingReader = (folder: SessionExplorerFolderRef) => SessionExplorerListing | null;

function createExplorerListingReader(_listingsVersion: number): ExplorerListingReader {
    return (folder) => readExplorerListing(folder);
}

/**
 * A listing reader that is a new function whenever a folder listing starts, finishes or fails, so a
 * memo that reads listings through it recomputes then (and re-renders its caller).
 */
export function useExplorerListingReader(): ExplorerListingReader {
    const listingsVersion = React.useSyncExternalStore(
        subscribeMachineFileBrowserDirectories,
        getMachineFileBrowserDirectoriesVersion,
        getMachineFileBrowserDirectoriesVersion,
    );
    return React.useMemo(() => createExplorerListingReader(listingsVersion), [listingsVersion]);
}

/**
 * The folders the user's computers share with a machine, as its last roots answer listed them (the
 * machine file browser's roots cache); null before it was asked. Read through the same version as the
 * listings: a roots answer bumps it.
 */
export function readExplorerSharedFolders(machine: SessionExplorerMachineRef): ReadonlyArray<SessionExplorerSharedFolder> | null {
    const roots = getCachedMachineFileBrowserRoots({ machineId: machine.machineId, serverId: machine.serverId });
    return roots ? roots.filter((root) => root.sharedFolder) : null;
}

/** Asks machines that were never asked which folders are shared with them. */
export function requestExplorerSharedFolders(machines: ReadonlyArray<SessionExplorerMachineRef>): void {
    for (const machine of machines) {
        fireAndForget(warmMachineFileBrowserRoots({ machineId: machine.machineId, serverId: machine.serverId }), { tag: 'sessionExplorer.sharedFolders' });
    }
}

/** Asks them again (the explorer's Refresh), keeping what shows until the answer arrives. */
export function refreshExplorerSharedFolders(machines: ReadonlyArray<SessionExplorerMachineRef>): void {
    for (const machine of machines) {
        fireAndForget(listMachineFileBrowserRoots({ machineId: machine.machineId, serverId: machine.serverId }), { tag: 'sessionExplorer.refreshSharedFolders' });
    }
}

/** Lists folders that were never listed; a folder already loading shares that request. */
export function requestExplorerListings(folders: ReadonlyArray<SessionExplorerFolderRef>): void {
    for (const folder of folders) {
        fireAndForget(warmMachineFileBrowserDirectoryCache(directoryTarget(folder)), { tag: 'sessionExplorer.listFolder' });
    }
}

/** Lists folders again while keeping what they show until the new listing arrives. */
export function refreshExplorerListings(folders: ReadonlyArray<SessionExplorerFolderRef>): void {
    for (const folder of folders) {
        if (getMachineFileBrowserDirectoryState(directoryTarget(folder))?.loading) continue;
        fireAndForget(listMachineFileBrowserDirectoryEntries(directoryTarget(folder)), { tag: 'sessionExplorer.refreshFolder' });
    }
}

/**
 * Lists the folder a row stands for again (a folder row, or the note under a folder that failed): each
 * kind of listing the explorer already holds for it, so the Sessions and the Files view both see a change.
 * A folder never listed is left to the explorer, which asks for the listing its view needs.
 */
export function refreshExplorerFolder(hint: Readonly<{ serverId: string; machineId: string; rootPath: string }> | null | undefined): void {
    if (!hint) return;
    refreshExplorerListings([false, true]
        .map((includeFiles) => ({ serverId: hint.serverId, machineId: hint.machineId, path: hint.rootPath, includeFiles }))
        .filter((folder) => getMachineFileBrowserDirectoryState(directoryTarget(folder)) !== null));
}

/** How often the explorer lists its open folders again while it shows, so changes made on the machine appear. */
export const EXPLORER_AUTO_REFRESH_MS = 3_000;
/** At most this many folders are asked in one round; the others come in the next rounds. */
export const EXPLORER_AUTO_REFRESH_BATCH = 12;

/** The folders one auto-refresh round asks, taking turns from `cursor`; and where the next round starts. */
export function pickExplorerAutoRefreshRound<T>(folders: ReadonlyArray<T>, cursor: number, batch = EXPLORER_AUTO_REFRESH_BATCH): Readonly<{ folders: T[]; next: number }> {
    if (folders.length === 0) return { folders: [], next: 0 };
    const start = cursor % folders.length;
    const count = Math.min(batch, folders.length);
    return {
        folders: Array.from({ length: count }, (_, index) => folders[(start + index) % folders.length]!),
        next: (start + count) % folders.length,
    };
}

/**
 * Keeps the explorer's open folders current: while it shows and the app is in front, each open folder is
 * listed again every EXPLORER_AUTO_REFRESH_MS in the background (`revalidateMachineFileBrowserDirectory`:
 * nothing flickers, and the tree changes only where a folder did), and once at once when the app comes back
 * to the front. A folder an agent or a terminal changed on the machine then shows the change within seconds.
 */
export function useExplorerAutoRefresh(openFolders: ReadonlyArray<SessionExplorerFolderRef>, enabled: boolean): void {
    const foldersRef = React.useRef(openFolders);
    foldersRef.current = openFolders;
    React.useEffect(() => {
        if (!enabled) return;
        let cursor = 0;
        return startRuntimeActiveGatedInterval(() => {
            if (!isHostVisible()) return;
            const round = pickExplorerAutoRefreshRound(foldersRef.current, cursor);
            cursor = round.next;
            for (const folder of round.folders) {
                fireAndForget(revalidateMachineFileBrowserDirectory(directoryTarget(folder)), { tag: 'sessionExplorer.autoRefresh' });
            }
        }, EXPLORER_AUTO_REFRESH_MS);
    }, [enabled]);
}
