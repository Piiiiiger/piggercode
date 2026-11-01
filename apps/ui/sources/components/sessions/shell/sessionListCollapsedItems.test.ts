import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { filterCollapsedSessionListItems } from './sessionListCollapsedItems';

function session(id: string, groupKey: string, folderId: string | null, folderDepth: number): Extract<SessionListViewItem, { type: 'session' }> {
    return {
        type: 'session',
        session: { id, active: true, createdAt: 1, updatedAt: 1 } as any,
        section: 'active',
        groupKey,
        groupKind: folderId ? 'folder' : 'project',
        folderId,
        folderDepth,
        serverId: 'server-a',
    };
}

describe('filterCollapsedSessionListItems', () => {
    it('hides descendant folder headers and sessions when a folder is collapsed', () => {
        const parentGroupKey = 'folder:server-a:workspace-a:parent';
        const childGroupKey = 'folder:server-a:workspace-a:child';
        const items: SessionListViewItem[] = [
            { type: 'header', headerKind: 'active', title: 'Active', serverId: 'server-a' },
            { type: 'header', headerKind: 'project', title: '~/repo', groupKey: 'project-a', serverId: 'server-a' },
            {
                type: 'header',
                headerKind: 'folder',
                title: 'Parent',
                groupKey: parentGroupKey,
                serverId: 'server-a',
                folderId: 'parent',
                parentFolderId: null,
                depth: 1,
                sessionCount: 1,
            },
            session('parent-session', parentGroupKey, 'parent', 1),
            {
                type: 'header',
                headerKind: 'folder',
                title: 'Child',
                groupKey: childGroupKey,
                serverId: 'server-a',
                folderId: 'child',
                parentFolderId: 'parent',
                depth: 2,
                sessionCount: 1,
            },
            session('child-session', childGroupKey, 'child', 2),
            session('root-session', 'project-a', null, 0),
        ];

        const filtered = filterCollapsedSessionListItems(items, { [parentGroupKey]: true });

        expect(filtered.map((item) => item.type === 'header'
            ? `header:${item.headerKind}:${item.folderId ?? 'root'}`
            : `session:${item.session.id}`
        )).toEqual([
            'header:active:root',
            'header:project:root',
            'header:folder:parent',
            'session:root-session',
        ]);
    });
    it('hides everything below a collapsed path folder and keeps its siblings', () => {
        const pathFolder = (title: string, treeKey: string, treeParentKey: string | null, depth: number): SessionListViewItem => ({
            type: 'header', headerKind: 'pathFolder', title, groupKey: `pathTree:${treeKey}`, treeKey, treeParentKey, depth, serverId: 'server-a',
        });
        const inFolder = (id: string, treeKey: string, depth: number): SessionListViewItem => ({
            ...session(id, `pathTree:${treeKey}`, null, depth),
            treeKey,
        });
        const items: SessionListViewItem[] = [
            { type: 'header', headerKind: 'sessions', title: 'Sessions', serverId: 'server-a' },
            pathFolder('~', 'home', null, 0),
            pathFolder('code', 'code', 'home', 1),
            pathFolder('happier', 'happier', 'code', 2),
            inFolder('deep', 'happier', 3),
            inFolder('in-code', 'code', 2),
            pathFolder('Downloads', 'downloads', 'home', 1),
            inFolder('in-downloads', 'downloads', 2),
            inFolder('in-home', 'home', 1),
        ];

        const filtered = filterCollapsedSessionListItems(items, { 'pathTree:code': true });

        expect(filtered.map((item) => item.type === 'header' ? `header:${item.title}` : `session:${item.session.id}`)).toEqual([
            'header:Sessions',
            'header:~',
            'header:code',
            'header:Downloads',
            'session:in-downloads',
            'session:in-home',
        ]);
    });
});
