import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from './sessionListViewData';
import {
    buildSessionExplorerItems,
    sessionExplorerFolderKey,
    type BuildSessionExplorerInput,
    type SessionExplorerListing,
    type SessionExplorerMachine,
} from './sessionListExplorer';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type Row = Extract<SessionListViewItem, { type: 'session' }>;

const vm: SessionExplorerMachine = { serverId: 's1', machineId: 'm1', label: 'vm', homeDir: '/home/u', online: true };

function row(id: string, path: string, options: { machineId?: string; active?: boolean; createdAt?: number; groupKey?: string } = {}): Row {
    return {
        type: 'session',
        session: {
            id,
            active: options.active ?? false,
            createdAt: options.createdAt ?? 1,
            updatedAt: options.createdAt ?? 1,
            metadata: { flavor: 'codex', path, machineId: options.machineId ?? 'm1', homeDir: '/home/u' },
        } as unknown as Row['session'],
        groupKey: options.groupKey ?? 'group',
        serverId: 's1',
    };
}

function folder(path: string): string {
    return sessionExplorerFolderKey({ serverId: 's1', machineId: 'm1', path });
}

function listings(byPath: Record<string, SessionExplorerListing>): BuildSessionExplorerInput['getListing'] {
    return (target) => byPath[target.path] ?? null;
}

function build(overrides: Partial<BuildSessionExplorerInput>) {
    return buildSessionExplorerItems({
        items: [],
        machines: [vm],
        defaultServerId: 's1',
        getListing: () => null,
        collapsedKeys: {},
        showHidden: false,
        sessionFoldersOnly: false,
        title: 'Explorer',
        ...overrides,
    });
}

/** `v` open folder, `>` closed folder, `•` session, `(…)` status row; two spaces per level. */
function outline(items: ReadonlyArray<SessionListViewItem>): string[] {
    return items.map((item) => {
        if (item.type === 'session') return `${'  '.repeat(item.folderDepth ?? 0)}• ${item.session.id}`;
        const indent = '  '.repeat(item.depth ?? 0);
        if (item.headerKind === 'pathFolder') return `${indent}${item.explorerExpanded ? 'v' : '>'} ${item.title}`;
        if (item.headerKind === 'explorerStatus') return `${indent}(${item.explorerStatus})`;
        return `# ${item.title}`;
    });
}

function folders(items: ReadonlyArray<SessionListViewItem>): Map<string, Header> {
    return new Map(items.flatMap((item) => (
        item.type === 'header' && item.headerKind === 'pathFolder' ? [[item.title, item] as const] : []
    )));
}

describe('buildSessionExplorerItems', () => {
    it('shows the machine\'s folders from ~ with each session under the folder it started in', () => {
        const result = build({
            items: [row('a', '/home/u/code/happier', { active: true, createdAt: 40 }), row('b', '/home/u', { createdAt: 30 })],
            getListing: listings({
                '/home/u': { status: 'loaded', dirs: ['Downloads', 'code', '.cache'] },
                '/home/u/code': { status: 'loaded', dirs: ['happier', 'grad'] },
                '/home/u/code/happier': { status: 'loaded', dirs: ['apps'] },
            }),
        });

        // Folders with sessions below them start open; the machine's other folders start closed.
        expect(outline(result.items)).toEqual([
            '# Explorer',
            'v ~',
            '  v code',
            '    > grad',
            '    v happier',
            '      > apps',
            '      • a',
            '  > Downloads',
            '  • b',
        ]);
        expect(result.foldersToList).toEqual([]);
        expect(result.openFolders.map((target) => target.path)).toEqual(['/home/u', '/home/u/code', '/home/u/code/happier']);
    });

    it('counts the sessions below each folder and starts new sessions in its exact path', () => {
        const result = build({
            items: [
                row('a', '/home/u/code/happier', { active: true, createdAt: 40 }),
                row('c', '/home/u/code/grad', { createdAt: 50 }),
                row('b', '/home/u', { createdAt: 30 }),
            ],
        });
        const byTitle = folders(result.items);
        const home = byTitle.get('~')!;
        const code = byTitle.get('code')!;

        expect(home.treeParentKey ?? null).toBeNull();
        expect(code.treeParentKey).toBe(home.treeKey);
        expect([home.sessionCount, home.activeSessionCount, home.seedSessionId]).toEqual([3, 1, 'c']);
        expect([code.sessionCount, code.activeSessionCount]).toEqual([2, 1]);
        expect(code.workspaceScopeHint).toEqual({ serverId: 's1', machineId: 'm1', rootPath: '/home/u/code' });
    });

    it('asks to list open folders once and says why an open folder shows nothing', () => {
        const unlisted = build({});
        expect(outline(unlisted.items)).toEqual(['# Explorer', 'v ~', '  (loading)']);
        expect(unlisted.foldersToList).toEqual([{ serverId: 's1', machineId: 'm1', path: '/home/u' }]);

        const status = (listing: SessionExplorerListing) => outline(build({ getListing: listings({ '/home/u': listing }) }).items);
        expect(status({ status: 'loading', dirs: null })).toEqual(['# Explorer', 'v ~', '  (loading)']);
        expect(status({ status: 'loaded', dirs: [] })).toEqual(['# Explorer', 'v ~', '  (empty)']);
        expect(status({ status: 'error', dirs: null })).toEqual(['# Explorer', 'v ~', '  (error)']);
        expect(status({ status: 'loaded', dirs: ['a'], truncated: true })).toEqual(['# Explorer', 'v ~', '  > a', '  (truncated)']);
        // A refresh keeps the folders it already shows instead of flashing a loading row.
        expect(status({ status: 'loading', dirs: ['a'] })).toEqual(['# Explorer', 'v ~', '  > a']);

        // An offline machine shows up with its sessions; a folder it never listed says why it is empty.
        expect(outline(build({ machines: [{ ...vm, online: false }] }).items)).toEqual(['# Explorer']);
        const offline = build({
            machines: [{ ...vm, online: false }],
            items: [row('s', '/home/u/a')],
            getListing: listings({ '/home/u': { status: 'loaded', dirs: ['a', 'b'] } }),
            collapsedKeys: { [folder('/home/u/b')]: false },
        });
        expect(outline(offline.items)).toEqual(['# Explorer', 'v ~', '  v a', '    • s', '  v b', '    (offline)']);
        expect(offline.foldersToList).toEqual([]);
    });

    it('keeps the user\'s open and closed choices and shows hidden folders on request or when they hold sessions', () => {
        const input: Partial<BuildSessionExplorerInput> = {
            items: [row('c', '/home/u/.config/x')],
            getListing: listings({ '/home/u': { status: 'loaded', dirs: ['.cache', '.config', 'code'] } }),
            collapsedKeys: { [folder('/home/u/code')]: false, [folder('/home/u/.config')]: true },
        };

        const result = build(input);
        expect(outline(result.items)).toEqual(['# Explorer', 'v ~', '  > .config', '  v code', '    (loading)']);
        expect(result.foldersToList.map((target) => target.path)).toEqual(['/home/u/code']);

        expect(outline(build({ ...input, showHidden: true }).items).slice(2, 4)).toEqual(['  > .cache', '  > .config']);
    });

    it('shows one top folder per machine when sessions come from several, with folders outside ~ under /', () => {
        const result = build({
            items: [row('a', '/home/u/x'), row('d', '/srv/app', { machineId: 'm2' })],
        });

        expect(outline(result.items)).toEqual([
            '# Explorer',
            'v m2',
            '  v /',
            '    v srv',
            '      v app',
            '        • d',
            'v vm',
            '  v ~',
            '    v x',
            '      • a',
        ]);
        // m2 is not an online machine, so only vm's open folders are listed.
        expect(result.foldersToList.map((target) => `${target.machineId}:${target.path}`)).toEqual(['m1:/home/u', 'm1:/home/u/x']);
    });

    it('while searching, shows only folders with sessions, all open, without listing anything', () => {
        const result = build({
            items: [row('a', '/home/u/code/happier')],
            getListing: listings({ '/home/u': { status: 'loaded', dirs: ['Downloads', 'code'] } }),
            collapsedKeys: { [folder('/home/u/code')]: true },
            sessionFoldersOnly: true,
        });

        expect(outline(result.items)).toEqual(['# Explorer', 'v ~', '  v code', '    v happier', '      • a']);
        expect(result.foldersToList).toEqual([]);
    });

    it('shows a session listed twice once and keeps unchanged rows and folders as the same objects', () => {
        const a = row('a', '/home/u/code', { groupKey: 'pinned' });
        const items: SessionListViewItem[] = [
            { type: 'header', headerKind: 'pinned', title: 'Pinned', groupKey: 'pinned', serverId: 's1' },
            a,
            { type: 'header', headerKind: 'project', title: '~/code', groupKey: 'project', serverId: 's1' },
            { ...a, groupKey: 'project' },
        ];
        const first = build({ items });
        expect(outline(first.items).filter((line) => line.includes('•'))).toEqual(['    • a']);

        const second = build({ items, previousItems: first.items });
        expect(second.items).toHaveLength(first.items.length);
        second.items.forEach((item, index) => expect(item).toBe(first.items[index]));
    });
});
