import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from './sessionListViewData';
import { applySessionPathTreeToSessionListViewData } from './sessionListPathTree';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type Row = Extract<SessionListViewItem, { type: 'session' }>;

function machine(id: string, homeDir: string, displayName: string) {
    return { id, metadata: { homeDir, displayName } } as unknown as NonNullable<Header['machine']>;
}

function project(rootPath: string, m: NonNullable<Header['machine']>): Header {
    return {
        type: 'header',
        headerKind: 'project',
        title: rootPath,
        groupKey: `server:s1:project:${m.id}:${rootPath}`,
        workspaceScopeHint: { serverId: 's1', machineId: m.id, rootPath },
        machine: m,
        serverId: 's1',
    };
}

function session(id: string, groupKey: string, active = false, createdAt = 1): Row {
    return {
        type: 'session',
        session: { id, active, createdAt, updatedAt: createdAt, metadata: { flavor: 'codex' } } as unknown as Row['session'],
        section: active ? 'active' : 'inactive',
        groupKey,
        groupKind: 'project',
        serverId: 's1',
    };
}

function outline(items: ReadonlyArray<SessionListViewItem>): string[] {
    return items.map((item) => item.type === 'header'
        ? `${item.headerKind}:${item.title}${item.headerKind === 'pathFolder' ? `@${item.depth}` : ''}`
        : `session:${item.session.id}@${item.folderDepth ?? 0}`);
}

describe('applySessionPathTreeToSessionListViewData', () => {
    const vm = machine('m1', '/home/u', 'vm');
    const happier = project('/home/u/code/happier', vm);
    const home = project('/home/u', vm);
    const logs = project('/var/log', vm);
    const downloads = project('/home/u/Downloads', vm);
    const source: SessionListViewItem[] = [
        { type: 'header', headerKind: 'sessions', title: 'Sessions', groupKey: 'sessions:s1', serverId: 's1' },
        happier, session('a', happier.groupKey!, true, 40),
        home, session('b', home.groupKey!, false, 30),
        logs, session('c', logs.groupKey!, false, 20),
        downloads, session('d', downloads.groupKey!, false, 10),
    ];

    it('nests sessions under their folders from ~ and /, merging single-child chains and sorting folders by name', () => {
        expect(outline(applySessionPathTreeToSessionListViewData(source))).toEqual([
            'sessions:Sessions',
            'pathFolder:~@0',
            'pathFolder:code/happier@1',
            'session:a@2',
            'pathFolder:Downloads@1',
            'session:d@2',
            'session:b@1',
            'pathFolder:/@0',
            'pathFolder:var/log@1',
            'session:c@2',
        ]);
    });

    it('links each folder to its parent, counts sessions below it and targets new sessions at its path', () => {
        const result = applySessionPathTreeToSessionListViewData(source);
        const folders = result.filter((item): item is Header => item.type === 'header' && item.headerKind === 'pathFolder');
        const byTitle = new Map(folders.map((folder) => [folder.title, folder]));
        const homeFolder = byTitle.get('~')!;
        const codeFolder = byTitle.get('code/happier')!;

        expect(homeFolder.treeParentKey ?? null).toBeNull();
        expect(codeFolder.treeParentKey).toBe(homeFolder.treeKey);
        expect([homeFolder.sessionCount, homeFolder.activeSessionCount]).toEqual([3, 1]);
        expect([byTitle.get('/')!.sessionCount, byTitle.get('/')!.activeSessionCount]).toEqual([1, 0]);
        expect(codeFolder.workspaceScopeHint).toEqual({ serverId: 's1', machineId: 'm1', rootPath: '/home/u/code/happier' });
        expect(homeFolder.seedSessionId).toBe('a');

        const sessionA = result.find((item): item is Row => item.type === 'session' && item.session.id === 'a')!;
        expect(sessionA.groupKey).toBe(codeFolder.groupKey);
        expect(sessionA.treeKey).toBe(codeFolder.treeKey);
    });

    it('starts with one folder per machine when sessions come from several machines', () => {
        const laptop = machine('m2', '/Users/me', 'laptop');
        const laptopProject = project('/Users/me/src', laptop);
        const result = applySessionPathTreeToSessionListViewData([
            ...source.slice(0, 3),
            laptopProject, session('e', laptopProject.groupKey!),
        ]);

        expect(outline(result)).toEqual([
            'sessions:Sessions',
            'pathFolder:laptop@0',
            'pathFolder:~@1',
            'pathFolder:src@2',
            'session:e@3',
            'pathFolder:vm@0',
            'pathFolder:~@1',
            'pathFolder:code/happier@2',
            'session:a@3',
        ]);
    });

    it('builds the tree only in the sections that use it, with folder keys unique to each section', () => {
        const activity: SessionListViewItem[] = [
            { type: 'header', headerKind: 'active', title: 'Active', serverId: 's1' },
            happier, session('a', happier.groupKey!, true, 40),
            { type: 'header', headerKind: 'inactive', title: 'Inactive', serverId: 's1' },
            home, session('b', home.groupKey!, false, 30),
        ];

        expect(outline(applySessionPathTreeToSessionListViewData(activity, { active: true, inactive: false }))).toEqual([
            'active:Active',
            'pathFolder:~@0',
            'pathFolder:code/happier@1',
            'session:a@2',
            'inactive:Inactive',
            'project:/home/u',
            'session:b@0',
        ]);

        const homeKeys = applySessionPathTreeToSessionListViewData(activity, { active: true, inactive: true })
            .filter((item): item is Header => item.type === 'header' && item.headerKind === 'pathFolder' && item.title === '~')
            .map((folder) => folder.treeKey);
        expect(homeKeys).toHaveLength(2);
        expect(new Set(homeKeys).size).toBe(2);
    });

    it('keeps each row object across rebuilds while its folder is unchanged', () => {
        const rowA = (items: ReadonlyArray<SessionListViewItem>) =>
            items.find((item) => item.type === 'session' && item.session.id === 'a');
        const first = applySessionPathTreeToSessionListViewData(source);
        const second = applySessionPathTreeToSessionListViewData([...source]);

        expect(rowA(second)).toBe(rowA(first));
    });

    it('leaves groups that are not folders in place', () => {
        const attention: SessionListViewItem[] = [
            { type: 'header', headerKind: 'attention', title: 'Needs you', groupKey: 'attention:s1', serverId: 's1' },
            { ...session('x', 'attention:s1', true), groupKind: 'attention' },
        ];
        expect(outline(applySessionPathTreeToSessionListViewData([...attention, ...source.slice(0, 3)]))).toEqual([
            'attention:Needs you',
            'session:x@0',
            'sessions:Sessions',
            'pathFolder:~@0',
            'pathFolder:code/happier@1',
            'session:a@2',
        ]);
    });
});
