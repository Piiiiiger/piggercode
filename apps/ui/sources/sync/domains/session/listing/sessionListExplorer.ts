import { resolveAbsolutePath } from '@/utils/path/pathUtils';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';

import type { SessionListViewItem } from './sessionListViewData';

type Header = Extract<SessionListViewItem, { type: 'header' }>;
type Row = Extract<SessionListViewItem, { type: 'session' }>;

export type SessionExplorerMachine = Readonly<{
    serverId: string;
    machineId: string;
    label: string;
    homeDir: string | null;
    /** Whether the explorer can list this machine's folders now. */
    online: boolean;
    /** False for a computer that runs no agents: the explorer lists it in neither view; the folders it shares show on the server. */
    agentsHosted?: boolean;
}>;

/** A machine of the explorer, by identity. */
export type SessionExplorerMachineRef = Readonly<{ serverId: string; machineId: string }>;

/**
 * A folder one of the user's computers shares with a machine, mounted there now: a root of that
 * machine's file browser carrying `sharedFolder` (`MachineFileBrowserRoot`).
 */
export type SessionExplorerSharedFolder = Readonly<{
    /** Where it is on the machine: `~/code`. */
    label: string;
    /** Where it is mounted on the machine. */
    path: string;
    sharedFolder?: Readonly<{ folder: string; computerMachineId?: string; computerLabel?: string }>;
}>;

export type SessionExplorerFolderRef = Readonly<{
    serverId: string;
    machineId: string;
    path: string;
    /** The Files view lists files too; that listing is cached apart from the folders-only one. */
    includeFiles?: boolean;
}>;

export type SessionExplorerListing = Readonly<{
    status: 'loading' | 'loaded' | 'error';
    /** Subfolder names; null until the first listing arrives. */
    dirs: ReadonlyArray<string> | null;
    /** File names, for a listing that includes files. */
    files?: ReadonlyArray<string> | null;
    truncated?: boolean;
}>;

/** Sessions: folders with the sessions that started in them. Files: folders and their files, without sessions. */
export type SessionExplorerMode = 'sessions' | 'files';

export type SessionExplorerStatus = NonNullable<Header['explorerStatus']>;

export type BuildSessionExplorerInput = Readonly<{
    /** The session list (any grouping); every session appears once in the explorer. */
    items: ReadonlyArray<SessionListViewItem>;
    /** Known machines; online ones show even without sessions, the others only with their sessions. */
    machines: ReadonlyArray<SessionExplorerMachine>;
    /** Server of rows that do not name one. */
    defaultServerId: string;
    getListing: (folder: SessionExplorerFolderRef) => SessionExplorerListing | null;
    /** Folders the user closed (true) or opened (false); the rest use the default. */
    collapsedKeys: Readonly<Record<string, boolean | undefined>>;
    showHidden: boolean;
    /** Search and tag filters: only folders with sessions, all open, no listings. */
    sessionFoldersOnly: boolean;
    title: string;
    /**
     * The folder each machine's tree starts at, keyed by sessionExplorerMachineKey (Open Folder).
     * Machines without one start at `~` (and `/` for sessions outside the home folder).
     */
    rootPaths: Readonly<Record<string, string | undefined>>;
    /** Title of the folder that holds the sessions outside an opened folder. */
    otherLocationsTitle: string;
    /** Sessions (the default) or Files. */
    mode?: SessionExplorerMode;
    /** The previous result, so unchanged folder rows keep their objects. */
    previousItems?: ReadonlyArray<SessionListViewItem> | null;
    /**
     * The folders shared with a machine as its last answer listed them (only the roots with
     * `sharedFolder` count); null before it was asked.
     */
    getSharedFolders?: (machine: SessionExplorerMachineRef) => ReadonlyArray<SessionExplorerSharedFolder> | null;
}>;

export type SessionExplorerResult = Readonly<{
    items: SessionListViewItem[];
    /** Open folders on online machines; a refresh lists these again. */
    openFolders: SessionExplorerFolderRef[];
    /** Open folders on online machines that were never listed; the caller loads them. */
    foldersToList: SessionExplorerFolderRef[];
    /** Online machines that run agents and were never asked which folders are shared with them. */
    sharedFoldersToAsk: SessionExplorerMachineRef[];
}>;

export const SESSION_EXPLORER_HEADER_KEY = 'explorer';

type NodeKind = NonNullable<Header['explorerNodeKind']>;

type Node = {
    name: string;
    key: string;
    path: string | null;
    kind: NodeKind;
    machine: SessionExplorerMachine;
    /** Open folders list the machine's subfolders; folders under Other locations show only their sessions. */
    browse: boolean;
    children: Map<string, Node>;
    sessions: Row[];
};

type Summary = Readonly<{ sessionCount: number; activeSessionCount: number; newest: Row | null }>;

const HOME = '~';
const ROOT = '/';
// Machine-level children besides `~` and `/`; folder names never reach this level.
const OPENED = ':opened';
const OTHER = ':other';

export function sessionExplorerMachineKey(serverId: string, machineId: string): string {
    return `explorer:${serverId}:${machineId}`;
}

export function sessionExplorerFolderKey(folder: SessionExplorerFolderRef): string {
    return `explorer:${folder.serverId}:${folder.machineId}:${folder.path}`;
}

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

function compareNames(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

function trimTrailingSlashes(path: string): string {
    const trimmed = path.replace(/\/+$/, '');
    return trimmed.length > 0 ? trimmed : ROOT;
}

function joinPath(parent: string, name: string): string {
    return parent === ROOT ? `${ROOT}${name}` : `${parent}/${name}`;
}

/** Where a session's folder sits: under the home folder (`~`) or the file system root (`/`). */
function locate(rawPath: string, homeDir: string | null): { root: typeof HOME | typeof ROOT; segments: string[] } | null {
    const absolute = resolveAbsolutePath(rawPath.trim(), homeDir ?? undefined);
    const display = formatPathRelativeToHome(absolute, homeDir ?? undefined);
    if (display === HOME || display.startsWith(`${HOME}/`)) {
        return { root: HOME, segments: display.slice(HOME.length).split('/').filter(Boolean) };
    }
    if (!absolute.startsWith(ROOT)) return null;
    return { root: ROOT, segments: absolute.split(/[\\/]+/).filter(Boolean) };
}

function createNode(input: Omit<Node, 'children' | 'sessions'>): Node {
    return { ...input, children: new Map(), sessions: [] };
}

function childFolder(parent: Node, name: string): Node {
    const existing = parent.children.get(name);
    if (existing) return existing;
    const path = parent.path === null ? null : joinPath(parent.path, name);
    const node = createNode({
        name,
        key: path === null
            ? `${parent.key}/${name}`
            : sessionExplorerFolderKey({ serverId: parent.machine.serverId, machineId: parent.machine.machineId, path }),
        path,
        kind: 'folder',
        machine: parent.machine,
        browse: parent.browse,
    });
    parent.children.set(name, node);
    return node;
}

/** `~` or `/` of a machine, or of the Other locations folder below an opened folder. */
function rootFolder(parent: Node, root: typeof HOME | typeof ROOT): Node {
    const existing = parent.children.get(root);
    if (existing) return existing;
    const { machine } = parent;
    const path = root === HOME ? (machine.homeDir ? trimTrailingSlashes(machine.homeDir) : null) : ROOT;
    const node = createNode({
        name: root,
        key: path === null
            ? `${parent.key}:${root}`
            : sessionExplorerFolderKey({ serverId: machine.serverId, machineId: machine.machineId, path }),
        path,
        kind: 'root',
        machine,
        browse: parent.browse,
    });
    parent.children.set(root, node);
    return node;
}

/** The folder the user opened as the top of this machine's tree. */
function openedFolder(machineNode: Node, rootPath: string): Node {
    const existing = machineNode.children.get(OPENED);
    if (existing) return existing;
    const { machine } = machineNode;
    const node = createNode({
        name: formatPathRelativeToHome(rootPath, machine.homeDir ?? undefined),
        key: sessionExplorerFolderKey({ serverId: machine.serverId, machineId: machine.machineId, path: rootPath }),
        path: rootPath,
        kind: 'root',
        machine,
        browse: true,
    });
    machineNode.children.set(OPENED, node);
    return node;
}

/** Holds the sessions outside the opened folder, in their usual folders, without browsing. */
function otherLocations(machineNode: Node, title: string): Node {
    const existing = machineNode.children.get(OTHER);
    if (existing) return existing;
    const node = createNode({
        name: title,
        key: `${machineNode.key}:other`,
        path: null,
        kind: 'other',
        machine: machineNode.machine,
        browse: false,
    });
    machineNode.children.set(OTHER, node);
    return node;
}

/**
 * Whether deleting `path` would delete the machine's home folder: it is that folder or one holding it.
 * Without a known home folder every path counts as holding it.
 */
export function explorerPathHoldsHomeFolder(path: string, homeDir: string | null | undefined): boolean {
    if (!homeDir) return true;
    const home = trimTrailingSlashes(homeDir);
    const folder = trimTrailingSlashes(path);
    return home === folder || home.startsWith(folder === ROOT ? ROOT : `${folder}/`);
}

/** The segments of `path` below `rootPath`, or null when it lies outside. */
function segmentsBelow(path: string, rootPath: string): string[] | null {
    if (path === rootPath) return [];
    const prefix = rootPath === ROOT ? ROOT : `${rootPath}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length).split('/').filter(Boolean) : null;
}

/**
 * The folder a typed name makes inside `parent`: a name, or a path inside it such as `notes/2026`.
 * Null when it would land elsewhere (it starts at `/` or `~`, or has a `.` or `..` part) or is empty.
 */
export function explorerChildFolderPath(parent: string, typedName: string): string | null {
    const name = typedName.trim();
    if (name.startsWith(ROOT) || name.startsWith(HOME)) return null;
    const segments = name.split('/').map((segment) => segment.trim()).filter((segment) => segment.length > 0);
    if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null;
    return joinPath(trimTrailingSlashes(parent), segments.join('/'));
}

/** Where a session started, as the explorer reads it; the store's sessions fit. */
export type SessionExplorerPlacement = Readonly<{
    active?: boolean | null;
    metadata?: Readonly<{ machineId?: string | null; path?: string | null }> | null;
}>;

/** The sessions that started in `folder.path` or a folder inside it on that machine, and how many still run. */
export function countSessionsInExplorerFolder(
    sessions: Iterable<SessionExplorerPlacement>,
    folder: Readonly<{ machineId: string; path: string; homeDir: string | null }>,
): { total: number; running: number } {
    const folderPath = trimTrailingSlashes(folder.path);
    let total = 0;
    let running = 0;
    for (const session of sessions) {
        const path = session.metadata?.path?.trim();
        if (!path || session.metadata?.machineId !== folder.machineId) continue;
        const absolute = trimTrailingSlashes(resolveAbsolutePath(path, folder.homeDir ?? undefined));
        if (segmentsBelow(absolute, folderPath) === null) continue;
        total += 1;
        if (session.active === true) running += 1;
    }
    return { total, running };
}

function summarize(node: Node, summaries: Map<Node, Summary>): Summary {
    let sessionCount = node.sessions.length;
    let activeSessionCount = 0;
    let newest: Row | null = null;
    for (const row of node.sessions) {
        if (row.session.active) activeSessionCount += 1;
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

const EMPTY_SUMMARY: Summary = { sessionCount: 0, activeSessionCount: 0, newest: null };

function sameScopeHint(a: Header['workspaceScopeHint'], b: Header['workspaceScopeHint']): boolean {
    if (!a || !b) return a === b;
    return a.serverId === b.serverId && a.machineId === b.machineId && a.rootPath === b.rootPath;
}

function sameHeader(a: Header, b: Header): boolean {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => left[key] === right[key]
        || (key === 'workspaceScopeHint' && sameScopeHint(a.workspaceScopeHint, b.workspaceScopeHint)));
}

const MACHINE_CHILD_ORDER: Readonly<Record<string, number>> = { [OPENED]: 0, [HOME]: 1, [ROOT]: 2, [OTHER]: 3 };

function sortChildren(node: Node): Node[] {
    if (node.kind === 'machine') {
        return [...node.children.entries()]
            .sort(([a], [b]) => (MACHINE_CHILD_ORDER[a] ?? 4) - (MACHINE_CHILD_ORDER[b] ?? 4))
            .map(([, child]) => child);
    }
    const children = [...node.children.values()];
    if (node.kind === 'other') {
        return children.sort((a, b) => (a.name === HOME ? 0 : 1) - (b.name === HOME ? 0 : 1));
    }
    return children.sort((a, b) => compareNames(a.name, b.name));
}

/**
 * The session list as a file explorer: each machine's folders from `~` (and `/` for sessions outside
 * the home folder), with every session under the folder it was started in. Open folders also show
 * the machine's other subfolders as the caller lists them, so a session can be started anywhere.
 * Folders with sessions below them start open, other folders closed, until the user toggles them.
 */
export function buildSessionExplorerItems(input: BuildSessionExplorerInput): SessionExplorerResult {
    const machineNodes = new Map<string, Node>();
    const machineNode = (machine: SessionExplorerMachine): Node => {
        const key = sessionExplorerMachineKey(machine.serverId, machine.machineId);
        const existing = machineNodes.get(key);
        if (existing) return existing;
        const node = createNode({ name: machine.label, key, path: null, kind: 'machine', machine, browse: true });
        machineNodes.set(key, node);
        return node;
    };
    const openedPathOf = (machine: SessionExplorerMachine): string | null => {
        const raw = input.rootPaths[sessionExplorerMachineKey(machine.serverId, machine.machineId)];
        const resolved = typeof raw === 'string' && raw.trim() ? resolveAbsolutePath(raw.trim(), machine.homeDir ?? undefined) : '';
        return resolved.startsWith(ROOT) ? trimTrailingSlashes(resolved) : null;
    };
    const filesMode = input.mode === 'files';
    const knownMachines = new Map<string, SessionExplorerMachine>();
    for (const machine of input.machines) {
        knownMachines.set(sessionExplorerMachineKey(machine.serverId, machine.machineId), machine);
    }
    // The folders the user's computers share with a machine are marked where they sit in its tree
    // (`~/code` by default), with the computer they come from.
    const sharedFrom = new Map<string, ReadonlyMap<string, string>>();
    const sharedFromOf = (machine: SessionExplorerMachine): ReadonlyMap<string, string> => {
        const key = sessionExplorerMachineKey(machine.serverId, machine.machineId);
        const known = sharedFrom.get(key);
        if (known) return known;
        const byPath = new Map<string, string>();
        for (const root of input.getSharedFolders?.(machine) ?? []) {
            if (!root.sharedFolder) continue;
            const computerId = root.sharedFolder.computerMachineId;
            const computer = computerId ? knownMachines.get(sessionExplorerMachineKey(machine.serverId, computerId)) : undefined;
            byPath.set(trimTrailingSlashes(root.path), computer?.label || root.sharedFolder.computerLabel || '');
        }
        sharedFrom.set(key, byPath);
        return byPath;
    };
    const sharedFoldersToAsk: SessionExplorerMachineRef[] = [];
    for (const machine of input.machines) {
        // An online machine shows its top folder to browse; others show up with their sessions.
        if (!machine.online) continue;
        // A computer that runs no agents lends its folders to the servers, where they show.
        if (machine.agentsHosted === false) continue;
        const opened = openedPathOf(machine);
        if (opened) openedFolder(machineNode(machine), opened);
        else if (machine.homeDir) rootFolder(machineNode(machine), HOME);
        if (input.getSharedFolders && input.getSharedFolders(machine) === null) {
            sharedFoldersToAsk.push({ serverId: machine.serverId, machineId: machine.machineId });
        }
    }

    const looseRows: Row[] = [];
    const seen = new Set<string>();
    let groupHeader: Header | null = null;
    // The Files view places no sessions: its tree is the machine's folders and files.
    for (const item of filesMode ? [] : input.items) {
        if (item.type === 'header') {
            groupHeader = item;
            continue;
        }
        const hint = groupHeader?.workspaceScopeHint ?? null;
        const serverId = item.serverId ?? hint?.serverId ?? input.defaultServerId;
        const rowKey = `${serverId}:${item.session.id}`;
        if (seen.has(rowKey)) continue;
        seen.add(rowKey);

        const metadata = item.session.metadata;
        // A project group's machine went through the session's machine-target resolution (a replaced
        // machine maps to its successor); the session's own path is the exact folder it started in.
        const machineId = hint?.machineId || metadata?.machineId || '';
        const path = metadata?.path || hint?.rootPath || '';
        if (!machineId || !path) {
            looseRows.push(item);
            continue;
        }
        const machineKey = sessionExplorerMachineKey(serverId, machineId);
        let machine = knownMachines.get(machineKey);
        if (!machine) {
            const display = groupHeader?.machine?.id === machineId ? groupHeader.machine : undefined;
            machine = {
                serverId,
                machineId,
                label: display?.metadata?.displayName || display?.metadata?.host || metadata?.host || machineId,
                homeDir: display?.metadata?.homeDir ?? metadata?.homeDir ?? null,
                online: false,
            };
            knownMachines.set(machineKey, machine);
        }
        // A computer that runs no agents gets no tree of its own: a session it once ran shows on its own.
        if (machine.agentsHosted === false) {
            looseRows.push(item);
            continue;
        }
        const opened = openedPathOf(machine);
        if (opened) {
            const below = segmentsBelow(trimTrailingSlashes(resolveAbsolutePath(path.trim(), machine.homeDir ?? undefined)), opened);
            if (below) {
                let node = openedFolder(machineNode(machine), opened);
                for (const segment of below) node = childFolder(node, segment);
                node.sessions.push(item);
                continue;
            }
        }
        const location = locate(path, machine.homeDir);
        if (!location) {
            looseRows.push(item);
            continue;
        }
        const parent = opened ? otherLocations(machineNode(machine), input.otherLocationsTitle) : machineNode(machine);
        let node = rootFolder(parent, location.root);
        for (const segment of location.segments) node = childFolder(node, segment);
        node.sessions.push(item);
    }

    const summaries = new Map<Node, Summary>();
    for (const node of machineNodes.values()) summarize(node, summaries);

    const previousHeaders = new Map<string, Header>();
    for (const item of input.previousItems ?? []) {
        if (item.type === 'header' && item.groupKey) previousHeaders.set(item.groupKey, item);
    }
    const out: SessionListViewItem[] = [];
    const pushHeader = (header: Header): void => {
        const previous = previousHeaders.get(header.groupKey ?? '');
        out.push(previous && sameHeader(previous, header) ? previous : header);
    };
    pushHeader({
        type: 'header',
        headerKind: 'explorer',
        title: input.title,
        groupKey: SESSION_EXPLORER_HEADER_KEY,
        serverId: input.defaultServerId,
    });
    const openFolders: SessionExplorerFolderRef[] = [];
    const foldersToList: SessionExplorerFolderRef[] = [];

    const isExpanded = (node: Node, summary: Summary): boolean => {
        if (input.sessionFoldersOnly) return true;
        const stored = input.collapsedKeys[node.key];
        if (stored === true) return false;
        if (stored === false) return true;
        if (node.kind === 'other') return false;
        return node.kind !== 'folder' || summary.sessionCount > 0;
    };

    const emit = (node: Node, depth: number, parentKey: string | null): void => {
        const summary = summaries.get(node) ?? EMPTY_SUMMARY;
        if (input.sessionFoldersOnly && summary.sessionCount === 0) return;
        const expanded = isExpanded(node, summary);
        const { machine } = node;
        // Folders are made and deleted where the tree lists an online machine's own folders.
        const managesFolders = !input.sessionFoldersOnly && node.browse && node.path !== null && machine.online;
        const shared = node.path === null ? undefined : sharedFromOf(machine).get(node.path);
        pushHeader({
            type: 'header',
            headerKind: 'pathFolder',
            title: node.name,
            groupKey: node.key,
            treeKey: node.key,
            treeParentKey: parentKey,
            depth,
            sessionCount: summary.sessionCount,
            activeSessionCount: summary.activeSessionCount,
            seedSessionId: summary.newest?.session.id ?? null,
            workspaceScopeHint: node.path === null
                ? null
                : { serverId: machine.serverId, machineId: machine.machineId, rootPath: node.path },
            explorerNodeKind: node.kind,
            explorerExpanded: expanded,
            explorerCanCreateFolder: managesFolders,
            // A shared folder itself is the share: renaming or deleting it here would act on the
            // computer's files, so only what is inside it can change. The machine refuses that too
            // (before it said which of its folders are shared, and for a folder holding one).
            explorerCanChange: managesFolders
                && node.kind === 'folder'
                && node.path !== null
                && shared === undefined
                && !explorerPathHoldsHomeFolder(node.path, machine.homeDir),
            ...(shared !== undefined ? { explorerSharedFrom: shared } : {}),
            serverId: machine.serverId,
        });
        if (!expanded) return;

        let listing: SessionExplorerListing | null = null;
        if (!input.sessionFoldersOnly && node.browse && node.path !== null) {
            const folder: SessionExplorerFolderRef = filesMode
                ? { serverId: machine.serverId, machineId: machine.machineId, path: node.path, includeFiles: true }
                : { serverId: machine.serverId, machineId: machine.machineId, path: node.path };
            listing = input.getListing(folder);
            if (machine.online) {
                openFolders.push(folder);
                if (!listing) foldersToList.push(folder);
            }
            for (const name of listing?.dirs ?? []) {
                if (!input.showHidden && name.startsWith('.') && !node.children.has(name)) continue;
                childFolder(node, name);
            }
        }

        for (const child of sortChildren(node)) emit(child, depth + 1, node.key);
        for (const row of node.sessions) out.push(placeRow(row, node.key, depth + 1));
        // Files view: the folder's files come after its subfolders.
        const files = filesMode && node.path !== null
            ? (listing?.files ?? []).filter((name) => input.showHidden || !name.startsWith('.')).slice().sort(compareNames)
            : [];
        for (const name of files) {
            pushHeader({
                type: 'header',
                headerKind: 'explorerFile',
                title: name,
                groupKey: `${node.key}#file:${name}`,
                treeParentKey: node.key,
                depth: depth + 1,
                // The file's own path; its row opens, renames or deletes it.
                workspaceScopeHint: { serverId: machine.serverId, machineId: machine.machineId, rootPath: joinPath(node.path!, name) },
                explorerCanChange: managesFolders,
                serverId: machine.serverId,
            });
        }

        if (input.sessionFoldersOnly || !node.browse || node.path === null) return;
        const shownNothing = node.children.size === 0 && node.sessions.length === 0 && files.length === 0;
        let status: SessionExplorerStatus | null = null;
        if (listing?.status === 'loaded') {
            if (listing.truncated) status = 'truncated';
            else if (shownNothing) status = 'empty';
        } else if (shownNothing) {
            if (!machine.online) status = 'offline';
            else status = listing?.status === 'error' ? 'error' : 'loading';
        }
        if (status) {
            pushHeader({
                type: 'header',
                headerKind: 'explorerStatus',
                title: node.name,
                groupKey: `${node.key}#status`,
                treeParentKey: node.key,
                depth: depth + 1,
                explorerStatus: status,
                // The folder the note is about, so a failed listing can be retried from it.
                workspaceScopeHint: { serverId: machine.serverId, machineId: machine.machineId, rootPath: node.path },
                serverId: machine.serverId,
            });
        }
    };

    const machines = [...machineNodes.values()].sort((a, b) => compareNames(a.name, b.name));
    if (machines.length === 1) {
        for (const root of sortChildren(machines[0]!)) emit(root, 0, null);
    } else {
        for (const machine of machines) emit(machine, 0, null);
    }
    out.push(...looseRows.map((row) => placeRow(row, `${SESSION_EXPLORER_HEADER_KEY}:loose`, 0)));
    return { items: out, openFolders, foldersToList, sharedFoldersToAsk };
}
