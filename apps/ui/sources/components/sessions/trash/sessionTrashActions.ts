import { sessionDeleteWithServerScope, sessionRestoreFromTrashWithServerScope } from '@/sync/ops';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSessionTrashStore } from '@/sync/domains/session/trash/sessionTrashStore';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { t } from '@/text';

/** The trash holds the active server's sessions, so its actions run against that server. */
function actionOptions(session: Session) {
    return { serverId: typeof session.serverId === 'string' && session.serverId.trim() ? session.serverId.trim() : null, metadata: session.metadata };
}

async function refreshAfterChange(): Promise<void> {
    await Promise.all([sync.refreshTrashedSessions(), sync.refreshSessions()]).catch(() => undefined);
}

export async function restoreTrashedSession(session: Session): Promise<boolean> {
    const result = await sessionRestoreFromTrashWithServerScope(session.id, actionOptions(session));
    if (!result.success) {
        Modal.alert(t('common.error'), result.message || t('sessionTrash.failedToRestore'));
        return false;
    }
    await refreshAfterChange();
    return true;
}

export async function deleteTrashedSessionNow(session: Session): Promise<boolean> {
    const confirmed = await Modal.confirm(t('sessionTrash.deleteNowTitle'), t('sessionTrash.deleteNowBody'), {
        cancelText: t('common.cancel'),
        confirmText: t('sessionTrash.deleteNow'),
        destructive: true,
    });
    if (!confirmed) return false;
    const result = await sessionDeleteWithServerScope(session.id, actionOptions(session));
    await refreshAfterChange();
    if (!result.success) {
        Modal.alert(t('common.error'), result.message || t('sessionTrash.failedToDelete'));
        return false;
    }
    return true;
}

export async function emptyTrash(sessions: ReadonlyArray<Session>): Promise<boolean> {
    // Only the whole trash is emptied: every page and every reported row must have been read.
    if (sessions.length === 0 || !useSessionTrashStore.getState().complete) return false;
    const confirmed = await Modal.confirm(t('sessionTrash.emptyTitle'), t('sessionTrash.emptyBody', { count: sessions.length }), {
        cancelText: t('common.cancel'),
        confirmText: t('sessionTrash.emptyTrash'),
        destructive: true,
    });
    if (!confirmed) return false;
    const failures: string[] = [];
    for (const session of sessions) {
        const result = await sessionDeleteWithServerScope(session.id, actionOptions(session));
        if (!result.success) failures.push(result.message || t('sessionTrash.failedToDelete'));
    }
    await refreshAfterChange();
    if (failures.length > 0) {
        Modal.alert(t('common.error'), t('sessionTrash.emptyPartiallyFailed', { count: failures.length, reason: failures[0]! }));
        return false;
    }
    return true;
}
