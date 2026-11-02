import { AGENT_IDS, inferAgentIdFromSessionMetadata, type AgentId } from '@piggercode/agents';

import { filterSessionListViewDataSessions } from './filterSessionListViewDataSessions';
import type { SessionListRenderableSession } from './sessionListRenderable';
import type { SessionListViewItem } from './sessionListViewData';

/** The agent (CLI) a session runs, as the list's agent picker groups it. */
export function resolveSessionListAgentId(session: SessionListRenderableSession): AgentId {
    return inferAgentIdFromSessionMetadata(session.metadata);
}

function isKnownAgentId(value: unknown): value is AgentId {
    return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
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

/**
 * The agent whose sessions the list shows: the one the user picked, else the agent of the most
 * recently updated session; null only while the list has no sessions and nothing was picked.
 */
export function resolveSessionListAgentSelection(
    picked: string | null | undefined,
    items: ReadonlyArray<SessionListViewItem>,
): AgentId | null {
    if (isKnownAgentId(picked)) return picked;
    let latest: SessionListRenderableSession | null = null;
    for (const item of items) {
        if (item.type !== 'session') continue;
        if (!latest || item.session.updatedAt > latest.updatedAt) latest = item.session;
    }
    return latest ? resolveSessionListAgentId(latest) : null;
}

/** The agents the picker offers: installed on a machine, used by a session, or picked; in catalog order. */
export function listSessionListAgentOptions(input: Readonly<{
    counts: ReadonlyMap<AgentId, number>;
    installed: ReadonlyArray<AgentId>;
    selected: AgentId | null;
}>): AgentId[] {
    const offered = new Set<AgentId>(input.installed);
    for (const [agentId, count] of input.counts) {
        if (count > 0) offered.add(agentId);
    }
    if (input.selected) offered.add(input.selected);
    return AGENT_IDS.filter((agentId) => offered.has(agentId));
}

/**
 * The agent's sessions and the headers above them. A list where every session already runs the
 * agent comes back as it is, so what the list derives from it (folders, rows) keeps its identity.
 */
export function filterSessionListViewDataByAgent(
    items: SessionListViewItem[],
    agentId: AgentId,
): SessionListViewItem[] {
    const runsAgent = (session: SessionListRenderableSession) => resolveSessionListAgentId(session) === agentId;
    if (items.every((item) => item.type !== 'session' || runsAgent(item.session))) return items;
    return filterSessionListViewDataSessions(items, runsAgent);
}
