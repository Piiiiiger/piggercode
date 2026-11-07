import * as React from 'react';

import {
    getCachedMachineFileBrowserRoots,
    getMachineFileBrowserDirectoriesVersion,
    getMachineFileBrowserDirectoryState,
    listMachineFileBrowserDirectoryEntries,
    listMachineFileBrowserRoots,
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
