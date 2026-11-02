import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from './sessionListViewData';
import {
    countSessionListSessionsByAgent,
    filterSessionListViewDataByAgent,
    listSessionListAgentOptions,
    resolveSessionListAgentSelection,
} from './sessionListAgentFilter';

type Row = Extract<SessionListViewItem, { type: 'session' }>;

function session(id: string, flavor: string, groupKey: string, updatedAt = 1): Row {
    return {
        type: 'session',
        session: { id, active: true, createdAt: 1, updatedAt, metadata: { flavor } } as unknown as Row['session'],
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

    it('keeps the list itself when every session runs the picked agent', () => {
        const onlyCodex: SessionListViewItem[] = [
            { type: 'header', headerKind: 'project', title: '~/repo', groupKey: 'p1', serverId: 's1' },
            session('a', 'codex', 'p1'),
            { type: 'header', headerKind: 'folder', title: 'Empty folder', groupKey: 'p1:folder:f1', serverId: 's1' },
        ];
        expect(filterSessionListViewDataByAgent(onlyCodex, 'codex')).toBe(onlyCodex);
    });

    it('keeps the picked agent, else picks the agent of the most recently updated session', () => {
        const recent: SessionListViewItem[] = [session('a', 'codex', 'p1', 10), session('b', 'claude', 'p1', 20)];
        expect(resolveSessionListAgentSelection('codex', recent)).toBe('codex');
        expect(resolveSessionListAgentSelection('gemini', recent)).toBe('gemini');
        expect(resolveSessionListAgentSelection(null, recent)).toBe('claude');
        expect(resolveSessionListAgentSelection('not-an-agent', recent)).toBe('claude');
        expect(resolveSessionListAgentSelection(null, [])).toBeNull();
    });

    it('offers the agents installed on the machines or used by sessions, plus the picked one, in catalog order', () => {
        const options = listSessionListAgentOptions({
            counts: new Map([['codex', 2]]),
            installed: ['gemini', 'claude'],
            selected: 'opencode',
        });
        expect(options).toEqual(['claude', 'codex', 'opencode', 'gemini']);
    });
});

