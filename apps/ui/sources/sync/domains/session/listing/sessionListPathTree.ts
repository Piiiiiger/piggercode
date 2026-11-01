import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';

import type { SessionListViewItem } from './sessionListViewData';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type Row = Extract<SessionListViewItem, { type: 'session' }>;

type ProjectGroup = { header: Header; sessions: Row[] };

type TreeNode = {
    label: string;
    key: string;
    /** Absolute folder on the machine; null when unknown (no home folder, no workspace hint). */
    absolutePath: string | null;
    /** Machine and `~` / `/` folders stay as they are; other folders merge single-child chains. */
    anchor: boolean;
    machineId: string;
    template: Header;
    children: Map<string, TreeNode>;
    sessions: Row[];
};

const ROOT_ORDER: Record<string, number> = { '~': 0, '/': 1 };

// A row keeps its object while its place in the tree is unchanged, so rebuilding the tree for one
// session's change does not re-render every mounted row.
const placedRows = new WeakMap<Row, Row>();

function placeRow(row: Row, treeKey: string, folderDepth: number): Row {
    const cached = placedRows.get(row);
    if (cached && cached.treeKey === treeKey && cached.folderDepth === folderDepth) return cached;
    const placed: Row = { ...row, groupKey: treeKey, treeKey, folderDepth };
    placedRows.set(row, placed);
    return placed;
}

function compareLabels(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function joinPath(parent: string | null, segment: string): string | null {
    if (parent === null) return null;
    return parent.endsWith('/') ? `${parent}${segment}` : `${parent}/${segment}`;
}

/** `~/code/x` → ['~', 'code', 'x'], `/var/log` → ['/', 'var', 'log']. */
function splitDisplayPath(displayPath: string): string[] {
    const trimmed = displayPath.trim();
    if (trimmed === '~' || trimmed === '/') return [trimmed];
    if (trimmed.startsWith('~/')) return ['~', ...trimmed.slice(2).split('/').filter(Boolean)];
    if (trimmed.startsWith('/')) return ['/', ...trimmed.slice(1).split('/').filter(Boolean)];
    return [trimmed];
}

function createNode(input: Omit<TreeNode, 'children' | 'sessions'>): TreeNode {
    return { ...input, children: new Map(), sessions: [] };
}

function childNode(parent: TreeNode, label: string, anchor: boolean, absolutePath: string | null): TreeNode {
    const existing = parent.children.get(label);
    if (existing) return existing;
    const node = createNode({
        label,
        key: `${parent.key}/${label}`,
        absolutePath,
        anchor,
        machineId: parent.machineId,
        template: parent.template,
    });
    parent.children.set(label, node);
    return node;
}

function compact(node: TreeNode): TreeNode {
    for (const [label, child] of node.children) node.children.set(label, compact(child));
    if (node.anchor || node.sessions.length > 0 || node.children.size !== 1) return node;
    const only = [...node.children.values()][0]!;
    return { ...only, label: `${node.label}/${only.label}`, anchor: false };
}

type Summary = { sessionCount: number; activeSessionCount: number; newest: Row | null };

function summarize(node: TreeNode, summaries: Map<TreeNode, Summary>): Summary {
    let sessionCount = node.sessions.length;
    let activeSessionCount = node.sessions.filter((row) => row.session.active).length;
    let newest: Row | null = null;
    for (const row of node.sessions) {
        if (!newest || row.session.createdAt > newest.session.createdAt) newest = row;
    }
    for (const child of node.children.values()) {
        const summary = summarize(child, summaries);
        sessionCount += summary.sessionCount;
        activeSessionCount += summary.activeSessionCount;
        if (summary.newest && (!newest || summary.newest.session.createdAt > newest.session.createdAt)) newest = summary.newest;
    }
    const summary = { sessionCount, activeSessionCount, newest };
    summaries.set(node, summary);
    return summary;
}

function emit(params: Readonly<{
    node: TreeNode;
    depth: number;
    parentKey: string | null;
    summaries: Map<TreeNode, Summary>;
    out: SessionListViewItem[];
}>): void {
    const { node, depth, out } = params;
    const summary = params.summaries.get(node)!;
    const { template } = node;
    const serverId = template.workspaceScopeHint?.serverId ?? template.serverId;
    out.push({
        type: 'header',
        headerKind: 'pathFolder',
        title: node.label,
        groupKey: node.key,
        treeKey: node.key,
        treeParentKey: params.parentKey,
        depth,
        sessionCount: summary.sessionCount,
        activeSessionCount: summary.activeSessionCount,
        seedSessionId: summary.newest?.session.id ?? null,
        workspaceScopeHint: serverId && node.absolutePath
            ? { serverId, machineId: node.machineId, rootPath: node.absolutePath }
            : null,
        machine: template.machine,
        ...(template.serverId ? { serverId: template.serverId } : {}),
        ...(template.serverName ? { serverName: template.serverName } : {}),
    });
    const children = [...node.children.values()].sort((a, b) => (
        (ROOT_ORDER[a.label] ?? 2) - (ROOT_ORDER[b.label] ?? 2) || compareLabels(a.label, b.label)
    ));
    for (const child of children) {
        emit({ ...params, node: child, depth: depth + 1, parentKey: node.key });
    }
    for (const row of node.sessions) {
        out.push(placeRow(row, node.key, depth + 1));
    }
}

function buildTree(groups: ReadonlyArray<ProjectGroup>, section: string): SessionListViewItem[] {
    const machineRoots = new Map<string, TreeNode>();
    for (const { header, sessions } of groups) {
        const hint = header.workspaceScopeHint ?? null;
        const machineId = hint?.machineId ?? header.machine?.id ?? '';
        const homeDir = header.machine?.metadata?.homeDir ?? null;
        const absolutePath = hint?.rootPath ?? null;
        const displayPath = absolutePath ? formatPathRelativeToHome(absolutePath, homeDir ?? undefined) : header.title;

        let machineRoot = machineRoots.get(machineId);
        if (!machineRoot) {
            machineRoot = createNode({
                label: header.machine?.metadata?.displayName || header.machine?.metadata?.host || header.subtitle || machineId,
                // Keys include the section: with active and inactive sections, a folder appears in both.
                key: `pathTree:${section}:${hint?.serverId ?? header.serverId ?? ''}:${machineId}`,
                absolutePath: homeDir,
                anchor: true,
                machineId,
                template: header,
            });
            machineRoots.set(machineId, machineRoot);
        }

        const [first, ...rest] = splitDisplayPath(displayPath);
        let node = childNode(machineRoot, first!, true, first === '~' ? homeDir : first === '/' ? '/' : absolutePath);
        for (const segment of rest) {
            node = childNode(node, segment, false, joinPath(node.absolutePath, segment));
        }
        node.sessions.push(...sessions);
    }

    const multipleMachines = machineRoots.size > 1;
    const roots: Array<{ node: TreeNode; depth: number }> = [];
    for (const machineRoot of [...machineRoots.values()].sort((a, b) => compareLabels(a.label, b.label))) {
        if (multipleMachines) {
            roots.push({ node: compact(machineRoot), depth: 0 });
            continue;
        }
        const topFolders = [...machineRoot.children.values()].sort((a, b) => (
            (ROOT_ORDER[a.label] ?? 2) - (ROOT_ORDER[b.label] ?? 2) || compareLabels(a.label, b.label)
        ));
        for (const folder of topFolders) roots.push({ node: compact(folder), depth: 0 });
    }

    const out: SessionListViewItem[] = [];
    for (const root of roots) {
        const summaries = new Map<TreeNode, Summary>();
        summarize(root.node, summaries);
        emit({ node: root.node, depth: root.depth, parentKey: null, summaries, out });
    }
    return out;
}

/** Which list sections show the tree; the one-section list (`sessions`) follows `active`. */
export type SessionPathTreeSections = Readonly<{ active: boolean; inactive: boolean }>;

const ALL_SECTIONS: SessionPathTreeSections = { active: true, inactive: true };

/**
 * Shows project groups as a folder tree: each session sits under the folder it was started in,
 * from `~` (or `/` outside the home folder) down, with one top folder per machine when sessions
 * come from several. Folders without sessions of their own and a single subfolder merge into one
 * row (`code/happier`). Folders sort by name; sessions keep the list's order. Other groups
 * (pinned, attention, working, date, shared) and sections not in `sections` stay as they are.
 */
export function applySessionPathTreeToSessionListViewData(
    items: ReadonlyArray<SessionListViewItem>,
    sections: SessionPathTreeSections = ALL_SECTIONS,
): SessionListViewItem[] {
    const out: SessionListViewItem[] = [];
    let section = 'sessions';
    let index = 0;
    while (index < items.length) {
        const item = items[index]!;
        if (item.type === 'header' && (item.headerKind === 'active' || item.headerKind === 'inactive' || item.headerKind === 'sessions')) {
            section = item.headerKind;
        }
        const treeInSection = section === 'inactive' ? sections.inactive : sections.active;
        if (!treeInSection || item.type !== 'header' || item.headerKind !== 'project') {
            out.push(item);
            index += 1;
            continue;
        }

        const groups: ProjectGroup[] = [];
        const loose: SessionListViewItem[] = [];
        while (index < items.length) {
            const current = items[index]!;
            if (current.type === 'header') {
                if (current.headerKind !== 'project') break;
                groups.push({ header: current, sessions: [] });
            } else {
                const group = groups[groups.length - 1];
                if (group && current.groupKey === group.header.groupKey) group.sessions.push(current);
                else loose.push(current);
            }
            index += 1;
        }
        out.push(...buildTree(groups, section), ...loose);
    }
    return out;
}
