import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from './sessionListViewData';
import { countSessionListSessionsByAgent, filterSessionListViewDataByAgent } from './sessionListAgentFilter';

type Row = Extract<SessionListViewItem, { type: 'session' }>;

function session(id: string, flavor: string, groupKey: string): Row {
    return {
        type: 'session',
        session: { id, active: true, createdAt: 1, updatedAt: 1, metadata: { flavor } } as unknown as Row['session'],
        section: 'active',
        groupKey,
        serverId: 's1',
    };
}

const items: SessionListViewItem[] = [
    { type: 'header', headerKind: 'pinned', title: 'Pinned', groupKey: 'pinned', serverId: 's1' },
    session('a', 'codex', 'pinned'),
    { type: 'header', headerKind: 'sessions', title: 'Sessions', groupKey: 'sessions', serverId: 's1' },
    { type: 'header', headerKind: 'project', title: '~/repo', groupKey: 'p1', serverId: 's1' },
    session('a', 'codex', 'p1'),
    session('b', 'claude', 'p1'),
    { type: 'header', headerKind: 'project', title: '~/other', groupKey: 'p2', serverId: 's1' },
    session('c', 'codex', 'p2'),
];

describe('session list agent filter', () => {
    it('counts each session once per agent', () => {
        expect(countSessionListSessionsByAgent(items)).toEqual(new Map([['codex', 2], ['claude', 1]]));
    });

    it('keeps only the agent\'s sessions and the headers above them', () => {
        const titlesAndIds = filterSessionListViewDataByAgent(items, 'claude')
            .map((item) => item.type === 'header' ? item.title : item.session.id);
        expect(titlesAndIds).toEqual(['Sessions', '~/repo', 'b']);
    });
});
