import { Modal } from '@/modal';
import {
    countSessionsInExplorerFolder,
    explorerChildFolderPath,
    explorerPathHoldsHomeFolder,
    type SessionExplorerMachine,
    type SessionExplorerPlacement,
} from '@/sync/domains/session/listing/sessionListExplorer';
import { decodeBase64 } from '@/encryption/base64';
import { machineCreateDirectory, machineDeletePath, machineReadFile, machineRenamePath } from '@/sync/ops/machines';
import { saveFileBytes } from '@/sync/runtime/files/saveFileBytes';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';

import { readExplorerListing } from './explorerDirectoryListings';

/** An explorer folder (or file) on its machine; `path` is absolute. */
export type ExplorerFolderTarget = Readonly<{
    serverId: string;
    machineId: string;
    path: string;
    homeDir: string | null;
}>;

/** The folder an explorer row stands for, with its machine's home folder. */
export function explorerFolderTarget(
    hint: Readonly<{ serverId: string; machineId: string; rootPath: string }> | null | undefined,
    machines: ReadonlyArray<SessionExplorerMachine>,
): ExplorerFolderTarget | null {
    if (!hint) return null;
    const machine = machines.find((candidate) => candidate.serverId === hint.serverId && candidate.machineId === hint.machineId);
    return { serverId: hint.serverId, machineId: hint.machineId, path: hint.rootPath, homeDir: machine?.homeDir ?? null };
}

function shownPath(folder: ExplorerFolderTarget): string {
    return formatPathRelativeToHome(folder.path, folder.homeDir ?? undefined);
}

/** Asks for a name, then makes that folder inside `parent`. Resolves to the new folder's path, or null. */
export async function createExplorerFolder(parent: ExplorerFolderTarget): Promise<string | null> {
    const title = t('files.createFolderPromptTitle');
    const typed = await Modal.prompt(title, shownPath(parent), {
        placeholder: t('promptLibrary.folderPlaceholder'),
        confirmText: t('common.create'),
        cancelText: t('common.cancel'),
    });
    if (typeof typed !== 'string' || typed.trim().length === 0) return null;
    const path = explorerChildFolderPath(parent.path, typed);
    if (!path) {
        Modal.alert(title, t('sessionsList.explorerFolderNameInvalid'));
        return null;
    }
    // The machine makes a folder that already exists without a word, so say so here.
    const slash = path.lastIndexOf('/');
    const name = path.slice(slash + 1);
    const directChild = (path.slice(0, slash) || '/') === parent.path;
    const listedDirs = [false, true].flatMap((includeFiles) => (
        readExplorerListing({ serverId: parent.serverId, machineId: parent.machineId, path: parent.path, includeFiles })?.dirs ?? []
    ));
    if (directChild && listedDirs.includes(name)) {
        Modal.alert(title, t('sessionsList.explorerFolderExists', { name }));
        return null;
    }
    const result = await machineCreateDirectory(parent.machineId, path, { serverId: parent.serverId });
    if (!result.success) {
        Modal.alert(t('common.error'), result.error || t('files.createFolderFailed'));
        return null;
    }
    return path;
}

/** Asks for a new name and renames the entry where it is. Resolves to the new path, or null. */
async function promptRenameInPlace(entry: ExplorerFolderTarget, title: string): Promise<string | null> {
    const slash = entry.path.lastIndexOf('/');
    const parentPath = entry.path.slice(0, slash) || '/';
    const currentName = entry.path.slice(slash + 1);
    const typed = await Modal.prompt(title, shownPath(entry), {
        defaultValue: currentName,
        placeholder: t('promptLibrary.folderPlaceholder'),
        confirmText: t('common.rename'),
        cancelText: t('common.cancel'),
    });
    if (typeof typed !== 'string' || typed.trim().length === 0 || typed.trim() === currentName) return null;
    // A new name keeps the entry where it is: one name, no path.
    const path = explorerChildFolderPath(parentPath, typed);
    if (!path || (path.slice(0, path.lastIndexOf('/')) || '/') !== parentPath) {
        Modal.alert(title, t('sessionsList.explorerRenameFolderInvalid'));
        return null;
    }
    const name = path.slice(path.lastIndexOf('/') + 1);
    // Names already taken in the folder, from whichever listings the explorer holds (folders, files).
    const taken = [false, true].flatMap((includeFiles) => {
        const listing = readExplorerListing({ serverId: entry.serverId, machineId: entry.machineId, path: parentPath, includeFiles });
        return [...(listing?.dirs ?? []), ...(listing?.files ?? [])];
    });
    if (taken.includes(name)) {
        Modal.alert(title, t('sessionsList.explorerFolderExists', { name }));
        return null;
    }
    const result = await machineRenamePath(entry.machineId, entry.path, path, { serverId: entry.serverId });
    if (!result.success) {
        Modal.alert(t('common.error'), result.error || t('files.repositoryTree.rename.failed'));
        return null;
    }
    return path;
}

/**
 * Asks for a new name and renames `folder` where it is. Refuses while sessions started in it (they would
 * lose their folder) and never renames the home folder or a folder holding it. Resolves to the new path, or null.
 */
export async function renameExplorerFolder(
    folder: ExplorerFolderTarget,
    sessions: Iterable<SessionExplorerPlacement>,
): Promise<string | null> {
    if (explorerPathHoldsHomeFolder(folder.path, folder.homeDir)) return null;
    const title = t('sessionsList.renameFolderPromptTitle');
    const inside = countSessionsInExplorerFolder(sessions, folder);
    if (inside.total > 0) {
        Modal.alert(title, t('sessionsList.explorerRenameFolderHasSessions', { count: inside.total }));
        return null;
    }
    return await promptRenameInPlace(folder, title);
}

/** Asks for a new name and renames the file where it is. Resolves to the new path, or null. */
export async function renameExplorerFile(file: ExplorerFolderTarget): Promise<string | null> {
    return await promptRenameInPlace(file, t('files.repositoryTree.rename.title'));
}

/** Confirms, then deletes the file. Resolves to true once it is gone. */
export async function deleteExplorerFile(file: ExplorerFolderTarget): Promise<boolean> {
    const confirmed = await Modal.confirm(
        t('files.repositoryTree.deleteFile.title'),
        t('files.repositoryTree.deleteFile.body', { path: shownPath(file) }),
        { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true },
    );
    if (!confirmed) return false;
    const result = await machineDeletePath(file.machineId, file.path, { serverId: file.serverId, recursive: false });
    if (!result.success) {
        Modal.alert(t('common.error'), result.error || t('files.repositoryTree.delete.failed'));
        return false;
    }
    return true;
}

/** Reads the file from its machine and hands it over as a download (the share sheet on phones). */
export async function downloadExplorerFile(file: ExplorerFolderTarget): Promise<boolean> {
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const read = await machineReadFile(file.machineId, file.path, { serverId: file.serverId });
    if (!read.success) {
        Modal.alert(t('common.error'), read.error);
        return false;
    }
    try {
        await saveFileBytes({
            name,
            bytes: decodeBase64(read.contentBase64),
            mimeType: 'application/octet-stream',
            dialogTitle: t('files.repositoryTree.actions.download'),
        });
        return true;
    } catch (error) {
        Modal.alert(t('common.error'), error instanceof Error ? error.message : t('files.repositoryTree.actions.download'));
        return false;
    }
}

/**
 * Confirms, then deletes `folder` with everything in it. Refuses while a session runs inside it and
 * never deletes the home folder or a folder holding it. Resolves to true once the folder is gone.
 */
export async function deleteExplorerFolder(
    folder: ExplorerFolderTarget,
    sessions: Iterable<SessionExplorerPlacement>,
): Promise<boolean> {
    if (explorerPathHoldsHomeFolder(folder.path, folder.homeDir)) return false;
    const title = t('files.repositoryTree.deleteFolder.title');
    const inside = countSessionsInExplorerFolder(sessions, folder);
    if (inside.running > 0) {
        Modal.alert(title, t('sessionsList.explorerDeleteFolderRunning', { count: inside.running }));
        return false;
    }
    const body = t('files.repositoryTree.deleteFolder.body', { path: shownPath(folder) });
    const confirmed = await Modal.confirm(
        title,
        inside.total > 0 ? `${body}\n\n${t('sessionsList.explorerDeleteFolderSessions', { count: inside.total })}` : body,
        {
            cancelText: t('common.cancel'),
            confirmText: t('files.repositoryTree.deleteFolder.confirm'),
            destructive: true,
        },
    );
    if (!confirmed) return false;
    const result = await machineDeletePath(folder.machineId, folder.path, { serverId: folder.serverId, recursive: true });
    if (!result.success) {
        Modal.alert(t('common.error'), result.error || t('files.repositoryTree.delete.failed'));
        return false;
    }
    return true;
}
