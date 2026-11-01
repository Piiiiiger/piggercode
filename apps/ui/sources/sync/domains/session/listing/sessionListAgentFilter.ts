import { inferAgentIdFromSessionMetadata, type AgentId } from '@happier-dev/agents';

import { filterSessionListViewDataSessions } from './filterSessionListViewDataSessions';
import type { SessionListRenderableSession } from './sessionListRenderable';
import type { SessionListViewItem } from './sessionListViewData';

/** The agent (CLI) a session runs, as the list's agent tabs group it. */
export function resolveSessionListAgentId(session: SessionListRenderableSession): AgentId {
    return inferAgentIdFromSessionMetadata(session.metadata);
}

/** Sessions per agent; a session listed twice (for example pinned and in its folder) counts once. */
export function countSessionListSessionsByAgent(items: ReadonlyArray<SessionListViewItem>): Map<AgentId, number> {
    const seen = new Set<string>();
    const counts = new Map<AgentId, number>();
    for (const item of items) {
        if (item.type !== 'session') continue;
        const key = `${item.serverId ?? ''}:${item.session.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const agentId = resolveSessionListAgentId(item.session);
        counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
    }
    return counts;
}

export function filterSessionListViewDataByAgent(
    items: ReadonlyArray<SessionListViewItem>,
    agentId: AgentId,
): SessionListViewItem[] {
    return filterSessionListViewDataSessions(items, (session) => resolveSessionListAgentId(session) === agentId);
}
