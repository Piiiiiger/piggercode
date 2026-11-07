import { Modal } from '@/modal';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { stopSessionBeforeDelete } from '@/components/sessions/sessionStopArchiveFlow';
import {
    countSessionsInExplorerFolder,
    explorerChildFolderPath,
    explorerPathHoldsHomeFolder,
    sessionsInExplorerFolder,
    type SessionExplorerMachine,
    type SessionExplorerPlacement,
} from '@/sync/domains/session/listing/sessionListExplorer';
import type { Session } from '@/sync/domains/state/storageTypes';
import { decodeBase64 } from '@/encryption/base64';
import { sessionDeleteWithServerScope, sessionStopWithServerScope } from '@/sync/ops';
import { machineCreateDirectory, machineDeletePath, machineReadFile, machineRenamePath } from '@/sync/ops/machines';
import { delay } from '@/utils/timing/time';
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

/** What deleting a folder's sessions uses; tests replace it. */
export type ExplorerFolderSessionOps = Readonly<{
    stopSession: typeof sessionStopWithServerScope;
    deleteSession: typeof sessionDeleteWithServerScope;
    isSessionActive?: (sessionId: string) => boolean | null;
}>;

const defaultSessionOps: ExplorerFolderSessionOps = {
    stopSession: sessionStopWithServerScope,
    deleteSession: sessionDeleteWithServerScope,
};

type FolderSessionTarget = ReturnType<typeof createSessionActionTarget>;

function sessionRuns(target: FolderSessionTarget): boolean {
    return target.isActive || target.isConnected || target.hasStoppableTerminalHost;
}

/**
 * Confirms, then deletes `folder` with everything in it and the sessions started in it (the user's own;
 * running ones are stopped first). A folder already gone from its machine (`missing`) deletes only its
 * sessions. Refuses while a session there runs that cannot be stopped from here (someone else's, or a kept
 * terminal that cannot be asked to stop), and never deletes the home folder or a folder holding it. The
 * sessions are read again after the confirmation and once more before anything is deleted, so one started
 * meanwhile is stopped too. Resolves to true once the folder is gone.
 */
export async function deleteExplorerFolder(
    folder: ExplorerFolderTarget,
    readSessions: () => Iterable<Session> | null,
    options: Readonly<{ missing?: boolean; ops?: ExplorerFolderSessionOps; waitMs?: number; pollMs?: number }> = {},
): Promise<boolean> {
    if (explorerPathHoldsHomeFolder(folder.path, folder.homeDir)) return false;
    const missing = options.missing === true;
    const ops = options.ops ?? defaultSessionOps;
    const title = missing ? t('sessionsList.explorerDeleteMissingFolderTitle') : t('files.repositoryTree.deleteFolder.title');
    // The sessions as this device knows them; null once they cannot be read for this folder's server.
    const readInside = (): FolderSessionTarget[] | null => {
        const sessions = readSessions();
        return sessions === null ? null : sessionsInExplorerFolder(sessions, folder)
            .map((session) => createSessionActionTarget({ session, serverId: folder.serverId }));
    };
    const refuseUnreadable = (targets: FolderSessionTarget[] | null): targets is null => {
        if (targets !== null) return false;
        Modal.alert(title, t('sessionsList.explorerDeleteFolderServerChanged'));
        return true;
    };
    // Sessions this account can delete (stopping them first where they run); the others must not run there.
    const blockedBy = (targets: readonly FolderSessionTarget[]) => targets.filter((target) => (
        !target.canDelete && (target.isOwnedByCurrentUser || sessionRuns(target))
    ));
    const refuseBlocked = (targets: readonly FolderSessionTarget[]): boolean => {
        const blocked = blockedBy(targets);
        if (blocked.length === 0) return false;
        Modal.alert(title, t('sessionsList.explorerDeleteFolderBlocked', { count: blocked.length }));
        return true;
    };

    const shown = readInside();
    if (refuseUnreadable(shown) || refuseBlocked(shown)) return false;
    const deletable = shown.filter((target) => target.canDelete);
    const running = deletable.filter(sessionRuns);
    let body: string;
    if (missing) {
        body = t('sessionsList.explorerDeleteMissingFolderBody', { path: shownPath(folder), count: deletable.length });
    } else {
        body = t('files.repositoryTree.deleteFolder.body', { path: shownPath(folder) });
        if (deletable.length > 0) body += `\n\n${t('sessionsList.explorerDeleteFolderSessions', { count: deletable.length })}`;
    }
    if (running.length > 0) body += ` ${t('sessionsList.explorerDeleteFolderRunning', { count: running.length })}`;
    const confirmed = await Modal.confirm(title, body, {
        cancelText: t('common.cancel'),
        confirmText: missing ? t('sessionInfo.deleteSession') : t('files.repositoryTree.deleteFolder.confirm'),
        destructive: true,
    });
    if (!confirmed) return false;

    // Stop what runs there first: nothing may keep working in a folder that is being deleted. What runs is
    // read again now (a session may have started or ended during the confirmation).
    const stopped = new Set<string>();
    for (let pass = 0; pass < 2; pass += 1) {
        const inside = readInside();
        if (refuseUnreadable(inside) || refuseBlocked(inside)) return false;
        const toStop = inside.filter((target) => target.canDelete && sessionRuns(target) && !stopped.has(target.sessionId));
        if (toStop.length === 0) break;
        for (const target of toStop) {
            const problem = await stopSessionBeforeDelete({
                sessionId: target.sessionId,
                stopSession: async () => await ops.stopSession(target.sessionId, { serverId: folder.serverId }),
                stopErrorMessage: t('sessionInfo.failedToStopSession'),
                ...(ops.isSessionActive ? { isActive: ops.isSessionActive } : {}),
            });
            if (problem !== null) {
                Modal.alert(title, t('sessionsList.explorerDeleteFolderStopFailed', { reason: problem }));
                return false;
            }
            stopped.add(target.sessionId);
        }
    }
    // Nothing may run there when the folder goes: the sessions just stopped must show as ended (one resumed
    // meanwhile, or started, keeps the folder).
    const deadline = Date.now() + (options.waitMs ?? 15_000);
    let inside = readInside();
    for (;;) {
        if (refuseUnreadable(inside) || refuseBlocked(inside)) return false;
        if (!inside.some((target) => target.canDelete && (target.isActive || target.isConnected))) break;
        if (Date.now() >= deadline) {
            Modal.alert(title, t('sessionsList.explorerDeleteFolderStopFailed', { reason: t('sessionInfo.stopSessionStillRunning') }));
            return false;
        }
        await delay(options.pollMs ?? 250);
        inside = readInside();
    }

    // The machine answers a folder that is already gone as deleted.
    if (!missing) {
        const result = await machineDeletePath(folder.machineId, folder.path, { serverId: folder.serverId, recursive: true });
        if (!result.success) {
            Modal.alert(t('common.error'), result.error || t('files.repositoryTree.delete.failed'));
            return false;
        }
    }

    const failures: string[] = [];
    for (const target of inside.filter((candidate) => candidate.canDelete)) {
        const result = await ops.deleteSession(target.sessionId, { serverId: folder.serverId });
        if (!result.success) failures.push(result.message || t('sessionInfo.failedToDeleteSession'));
    }
    if (failures.length > 0) {
        Modal.alert(title, t('sessionsList.explorerDeleteFolderSessionsFailed', { count: failures.length, reason: failures[0]! }));
    }
    return true;
}
