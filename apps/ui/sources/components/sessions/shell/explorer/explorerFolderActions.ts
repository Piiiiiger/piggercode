import { Modal } from '@/modal';
import {
    countSessionsInExplorerFolder,
    explorerChildFolderPath,
    explorerPathHoldsHomeFolder,
    type SessionExplorerMachine,
    type SessionExplorerPlacement,
} from '@/sync/domains/session/listing/sessionListExplorer';
import { machineCreateDirectory, machineDeletePath } from '@/sync/ops/machines';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';

import { readExplorerListing } from './explorerDirectoryListings';

/** An explorer folder on its machine; `path` is absolute. */
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
    const listing = readExplorerListing({ serverId: parent.serverId, machineId: parent.machineId, path: parent.path });
    if (directChild && listing?.dirs?.includes(name)) {
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
