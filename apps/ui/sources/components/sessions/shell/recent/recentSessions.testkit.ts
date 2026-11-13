import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

export const MINUTE = 60_000;

/** A running session as the list holds it, `fields` changing what differs; times count back from `nowMs`. */
export function recentTestSession(
    id: string,
    nowMs: number,
    fields: Partial<SessionListRenderableSession> = {},
): SessionListRenderableSession {
    return {
        id,
        seq: 0,
        createdAt: nowMs - 600 * MINUTE,
        updatedAt: nowMs,
        active: true,
        activeAt: nowMs - MINUTE / 4,
        archivedAt: null,
        pendingVersion: undefined,
        pendingCount: undefined,
        metadataVersion: 0,
        agentStateVersion: 0,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        owner: undefined,
        accessLevel: undefined,
        canApprovePermissions: undefined,
        hasPendingPermissionRequests: undefined,
        hasPendingUserActionRequests: undefined,
        hasUnreadMessages: false,
        keepVisibleWhenInactive: false,
        ...fields,
    } as SessionListRenderableSession;
}

/** The session's row as the explorer gets it from the list. */
export function recentTestRow(session: SessionListRenderableSession): Extract<SessionListViewItem, { type: 'session' }> {
    return { type: 'session', session, serverId: 'server-1', groupKey: 'folder:/home/u/code', treeKey: 'folder:/home/u/code', folderDepth: 2 };
}
