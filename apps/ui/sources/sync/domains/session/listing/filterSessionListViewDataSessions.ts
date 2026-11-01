import type { SessionListRenderableSession } from './sessionListRenderable';
import type { SessionListViewItem } from './sessionListViewData';

/**
 * Keeps the sessions `keep` accepts and only the server, section and group headers that still
 * have one of them below. Shared by the list filters (storage kind, agent).
 */
export function filterSessionListViewDataSessions(
    source: ReadonlyArray<SessionListViewItem>,
    keep: (session: SessionListRenderableSession) => boolean,
): SessionListViewItem[] {
    const out: SessionListViewItem[] = [];
    let pendingServerHeader: Extract<SessionListViewItem, { type: 'header' }> | null = null;
    let pendingSectionHeader: Extract<SessionListViewItem, { type: 'header' }> | null = null;
    let pendingGroupHeader: Extract<SessionListViewItem, { type: 'header' }> | null = null;

    for (const item of source) {
        if (item.type === 'header') {
            if (item.headerKind === 'server') {
                pendingServerHeader = item;
                continue;
            }
            if (item.headerKind === 'active' || item.headerKind === 'inactive' || item.headerKind === 'sessions') {
                pendingSectionHeader = item;
                pendingGroupHeader = null;
                continue;
            }
            pendingGroupHeader = item;
            continue;
        }

        if (!keep(item.session)) {
            continue;
        }

        if (pendingServerHeader) out.push(pendingServerHeader);
        if (pendingSectionHeader) out.push(pendingSectionHeader);
        if (pendingGroupHeader) out.push(pendingGroupHeader);
        pendingServerHeader = null;
        pendingSectionHeader = null;
        pendingGroupHeader = null;
        out.push(item);
    }

    return out;
}
