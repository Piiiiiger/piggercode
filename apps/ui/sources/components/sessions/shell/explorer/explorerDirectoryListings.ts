import * as React from 'react';

import {
    getMachineFileBrowserDirectoriesVersion,
    getMachineFileBrowserDirectoryState,
    listMachineFileBrowserDirectoryEntries,
    subscribeMachineFileBrowserDirectories,
    warmMachineFileBrowserDirectoryCache,
} from '@/sync/domains/input/machineFileBrowser';
import type { SessionExplorerFolderRef, SessionExplorerListing } from '@/sync/domains/session/listing/sessionListExplorer';
import { fireAndForget } from '@/utils/system/fireAndForget';

// The Sessions view lists folders only, the Files view folders and files; the machine file browser owns
// the cache (one per kind of listing), in-flight sharing and errors.
function directoryTarget(folder: SessionExplorerFolderRef) {
    return { machineId: folder.machineId, serverId: folder.serverId, directoryPath: folder.path, includeFiles: folder.includeFiles === true };
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
