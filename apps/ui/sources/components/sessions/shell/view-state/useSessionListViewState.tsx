import React from 'react';

import { useResolvedActiveServerSelection } from '@/hooks/server/useEffectiveServerSelection';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { useIsTablet } from '@/utils/platform/responsive';
import {
    SessionListViewItem,
    useLocalSetting,
    useLocalSettingMutable,
    useMachineDisplayById,
    useProfile,
    useSessionExplorerMachines,
    useSessionOrganizationProjection,
    useSetting,
    useSettingMutable,
} from '@/sync/domains/state/storage';
import { applySessionFoldersToSessionListViewData } from '@/sync/domains/session/listing/sessionListViewData';
import {
    filterSessionListViewDataByAgent,
    resolveSessionListAgentSelection,
} from '@/sync/domains/session/listing/sessionListAgentFilter';
import {
    buildSessionExplorerItems,
    type SessionExplorerFolderRef,
    type SessionExplorerMachine,
    type SessionExplorerMachineRef,
} from '@/sync/domains/session/listing/sessionListExplorer';
import {
    buildSessionListIndexFromViewData,
    type SessionListIndexItem,
} from '@/sync/domains/session/listing/sessionListIndex';
import type { SessionFolderV1, SessionFoldersV1 } from '@/sync/domains/session/folders';
import { normalizeSessionListFolderSortMode } from '@/sync/domains/session/listing/sessionListFolderSortMode';
import {
    normalizeSessionListOrderingModeV1,
    resolveEffectiveSessionListFolderSortMode,
} from '@/sync/domains/session/listing/sessionListOrderingRules';
import {
    buildSessionOrganizationListViewState,
    buildSessionOrganizationReorderRequestFromGroupOrder,
    buildSessionOrganizationReorderRequestFromWorkspaceOrder,
} from '@/sync/domains/session/organization/viewState';
import {
    deleteSessionFolder as deleteSessionOrganizationFolder,
    deleteSessionLabel as deleteSessionOrganizationLabel,
    reorderSessionOrganization,
    setSessionPin as setSessionOrganizationPin,
    setSessionTagLabels as setSessionOrganizationTagLabels,
    upsertSessionFolder as upsertSessionOrganizationFolder,
    upsertSessionLabel as upsertSessionOrganizationLabel,
} from '@/sync/ops/sessionOrganization';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';
import { Modal } from '@/modal';
import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';

import {
    countCollapsedSessionListGroups,
    filterCollapsedSessionListItems,
} from '../sessionListCollapsedItems';
import {
    buildSessionListReachabilityModels,
    createSessionListReachabilityModelsCache,
} from '../sessionListReachabilityModels';
import {
    buildSessionListSelectedItems,
    type SessionListSelectedItem,
} from '../sessionListSelectedItems';
import {
    filterSessionListItemsByFocusedFolder,
    type SessionFolderViewModeV1,
} from '../sessionFolderShellTypes';
import { getAllKnownTags } from '../sessionTagUtils';
import { useSessionAttentionStandingInputs } from '@/hooks/session/useSessionAttentionStandingInputs';
import { useSessionListFocusedFolderState } from './useSessionListFocusedFolderState';
import type { SessionListStorageFilter } from '@/sync/domains/session/sessionStorageKind';
import {
    filterSessionListItemsForHeaderControls,
    hasActiveSessionListHeaderFilters,
    type SessionListHeaderFilterInput,
} from '../sessionListFilters';
import { useSessionListSnapshotWhenInactive } from '../surface/useSessionListSnapshotWhenInactive';
import {
    readExplorerSharedFolders,
    requestExplorerListings,
    requestExplorerSharedFolders,
    useExplorerAutoRefresh,
    useExplorerListingReader,
} from '../explorer/explorerDirectoryListings';
import { resolveSessionOrganizationMutationScope, type SessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';

const EMPTY_SESSION_KEYS: ReadonlyArray<string> = Object.freeze([]);
const EMPTY_EXPLORER_FOLDERS: ReadonlyArray<SessionExplorerFolderRef> = Object.freeze([]);
const EMPTY_EXPLORER_MACHINES: ReadonlyArray<SessionExplorerMachineRef> = Object.freeze([]);
const EMPTY_EXPLORER_ROOT_PATHS: Readonly<Record<string, string>> = Object.freeze({});
const EMPTY_SESSION_LIST_GROUP_ORDER: Readonly<Record<string, ReadonlyArray<string> | undefined>> = Object.freeze({});
const EMPTY_SESSION_WORKSPACE_ORDER: Readonly<Record<string, ReadonlyArray<string> | undefined>> = Object.freeze({});

const useSessionFolderViewModeMutable = useSettingMutable as unknown as (
    name: 'sessionFolderViewModeV1'
) => [SessionFolderViewModeV1 | null | undefined, (value: SessionFolderViewModeV1) => void];
const useCollapsedGroupKeysMutable = useLocalSettingMutable as unknown as (
    name: 'collapsedGroupKeysV1'
) => [Readonly<Record<string, boolean>>, (value: Readonly<Record<string, boolean>>) => void];

function countSessionListItems(items: ReadonlyArray<SessionListViewItem> | null | undefined): number {
    if (!items) return 0;
    return items.reduce((count, item) => count + (item.type === 'session' ? 1 : 0), 0);
}

function parseServerScopedSessionKey(serverId: string, keyRaw: unknown): string | null {
    const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
    const prefix = `${serverId}:`;
    if (!key.startsWith(prefix)) return null;
    const sessionId = key.slice(prefix.length).trim();
    return sessionId || null;
}

function normalizeStringArray(values: readonly string[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values ?? []) {
        const normalized = typeof value === 'string' ? value.trim() : '';
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function buildFolderDisplay(folder: SessionFolderV1): { t: 'plain'; v: { name: string; workspace: SessionFolderV1['workspace'] } } {
    return {
        t: 'plain',
        v: {
            name: folder.name,
            workspace: folder.workspace,
        },
    };
}

function areFolderDefinitionsEqual(left: SessionFolderV1, right: SessionFolderV1): boolean {
    return left.name === right.name
        && left.parentId === right.parentId
        && (left.sortKey ?? null) === (right.sortKey ?? null)
        && JSON.stringify(left.workspace) === JSON.stringify(right.workspace);
}

function measureSessionListRenderDerivation<T>(
    name: string,
    items: ReadonlyArray<SessionListViewItem> | null | undefined,
    fields: () => Readonly<Record<string, number>>,
    compute: () => T,
): T {
    if (!syncPerformanceTelemetry.isEnabled()) {
        return compute();
    }
    return syncPerformanceTelemetry.measure(
        name,
        {
            items: items?.length ?? 0,
            ...fields(),
        },
        compute,
    );
}

export type UseSessionListViewStateInput = Readonly<{
    data: SessionListViewItem[] | null;
    pathname: string;
    storageKind?: SessionListStorageFilter;
    headerFilters?: SessionListHeaderFilterInput;
    sessionListSurfaceDataActive?: boolean;
}>;

export function useSessionListViewState({
    data,
    headerFilters,
    pathname,
    sessionListSurfaceDataActive = true,
    storageKind,
}: UseSessionListViewStateInput) {
    const isTablet = useIsTablet();
    const [sessionMruOrderV1, setSessionMruOrderV1] = useLocalSettingMutable('sessionMruOrderV1');
    const [sessionListFolderSortModeRaw, setSessionListFolderSortModeV1] = useLocalSettingMutable('sessionListFolderSortModeV1');
    const [sessionListOrderingModeRaw, setSessionListOrderingModeV1] = useSettingMutable('sessionListOrderingModeV1');
    const [sessionFolderViewModeRaw, setSessionFolderViewModeV1] = useSessionFolderViewModeMutable('sessionFolderViewModeV1');
    const sessionTagsEnabled = useSetting('sessionTagsEnabled');
    const [hideInactiveSessionsSetting, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const rememberLastProjectSessionSelections = useSetting('rememberLastProjectSessionSelections') !== false;
    const workspaceFaviconsEnabled = useSetting('workspaceFaviconsEnabled') !== false;
    const workspaceMachineSubtitlesEnabled = useSetting('workspaceMachineSubtitlesEnabled') !== false;
    const [collapsedGroupKeysV1, setCollapsedGroupKeysV1] = useCollapsedGroupKeysMutable('collapsedGroupKeysV1');
    const sessionListDensity = useSetting('sessionListDensity');
    const sessionListLayout = useSetting('sessionListLayoutV1');
    const [explorerRootPathsSetting, setExplorerRootPaths] = useSettingMutable('sessionListExplorerRootsV1');
    const explorerRootPaths = explorerRootPathsSetting ?? EMPTY_EXPLORER_ROOT_PATHS;
    const sessionListAgentFilter = useLocalSetting('sessionListAgentFilterV1');
    const [explorerShowHidden, setExplorerShowHidden] = useLocalSettingMutable('sessionListExplorerShowHiddenV1');
    const [explorerModeSetting, setExplorerMode] = useLocalSettingMutable('sessionListExplorerModeV1');
    const explorerMode = explorerModeSetting === 'files' ? 'files' : 'sessions';
    const explorerMachineSummaries = useSessionExplorerMachines();
    const readExplorerListing = useExplorerListingReader();
    const profile = useProfile();
    const machineDisplayById = useMachineDisplayById();
    const renderMachineDisplayById = useSessionListSnapshotWhenInactive(
        machineDisplayById,
        sessionListSurfaceDataActive,
    );
    const selection = useResolvedActiveServerSelection();
    const activeOrganizationServerId = selection.activeServerId ?? null;
    const organizationProjection = useSessionOrganizationProjection(activeOrganizationServerId);
    const organizationListViewState = React.useMemo(() => buildSessionOrganizationListViewState({
        serverId: activeOrganizationServerId ?? '',
        projection: organizationProjection,
    }), [activeOrganizationServerId, organizationProjection]);
    const sessionFoldersDecision = useFeatureDecision('sessions.folders');

    const hideInactiveSessions = hideInactiveSessionsSetting === true;
    const compactSessionView = sessionListDensity === 'cozy' || sessionListDensity === 'narrow';
    const compactSessionViewMinimal = sessionListDensity === 'narrow';
    const currentUserId = typeof profile?.id === 'string' ? profile.id : null;
    const selectedServerCount = selection.allowedServerIds?.length ?? 0;
    const showServerBadge = selection.enabled && selection.presentation === 'flat-with-badge' && selectedServerCount > 1;
    const showPinnedServerBadge = selection.enabled && selectedServerCount > 1;
    const selectable = isTablet;
    // The explorer shows each machine's folders with every session under the folder it started in.
    const explorerEnabled = sessionListLayout === 'explorer' && storageKind !== 'direct';
    // User folders nest sessions inside project groups; in the explorer, a session's folder is its directory.
    const folderActionsEnabled = storageKind !== 'direct' && sessionFoldersDecision?.state === 'enabled' && !explorerEnabled;
    const sessionFolderViewMode: SessionFolderViewModeV1 = sessionFolderViewModeRaw === 'tree' ? 'tree' : 'off';
    const sessionListSavedFolderSortMode = normalizeSessionListFolderSortMode(sessionListFolderSortModeRaw);
    const sessionListOrderingMode = normalizeSessionListOrderingModeV1(sessionListOrderingModeRaw);
    const sessionListFolderSortMode = resolveEffectiveSessionListFolderSortMode({
        orderingMode: sessionListOrderingMode,
        folderSortMode: sessionListSavedFolderSortMode,
    });
    const folderViewEnabled = folderActionsEnabled && sessionFolderViewMode === 'tree';
    const sessionFoldersV1 = organizationListViewState.sessionFoldersV1;
    const sessionTagsV1 = organizationListViewState.sessionTagsV1 as Record<string, string[]>;
    const sessionFolderAssignmentsBySessionKey = organizationListViewState.sessionFolderAssignmentsBySessionKey;
    const attentionStanding = useSessionAttentionStandingInputs(
        organizationListViewState.attentionStandingOverridesBySessionKey,
    );
    const pinnedKeyList = Array.isArray(organizationListViewState.pinnedSessionKeysV1)
        ? organizationListViewState.pinnedSessionKeysV1
        : EMPTY_SESSION_KEYS;
    const sessionListGroupOrderV1 = organizationListViewState.sessionListGroupOrderV1;
    const sessionWorkspaceOrderV1 = organizationListViewState.sessionWorkspaceOrderV1;
    const workspaceLabelsV1 = organizationListViewState.workspaceLabelsV1;
    const currentGroupOrderMap = sessionListGroupOrderV1 ?? EMPTY_SESSION_LIST_GROUP_ORDER;
    const currentWorkspaceOrderMap = sessionWorkspaceOrderV1 ?? EMPTY_SESSION_WORKSPACE_ORDER;

    const pinnedKeySet = React.useMemo(() => {
        return new Set(pinnedKeyList);
    }, [pinnedKeyList]);

    const allKnownTags = React.useMemo(() => getAllKnownTags(sessionTagsV1), [sessionTagsV1]);

    const getOrganizationMutationContext = React.useCallback(async (): Promise<SessionOrganizationMutationScope | null> => {
        const resolved = await resolveSessionOrganizationMutationScope(activeOrganizationServerId);
        return resolved.ok ? resolved.scope : null;
    }, [activeOrganizationServerId]);

    const runOrganizationMutation = React.useCallback((mutation: () => Promise<void>) => {
        void mutation().catch((error: unknown) => {
            Modal.alert(
                t('common.error'),
                error instanceof HappyError ? error.message : t('errors.unknownError'),
            );
        });
    }, []);

    const setPinnedSessionKeysV1 = React.useCallback((nextKeysRaw: readonly string[]) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const nextKeys = new Set(normalizeStringArray(nextKeysRaw));
            const currentKeys = new Set(pinnedKeyList);
            const changes: Array<{ sessionId: string; pinned: boolean; sortKey?: string | null }> = [];
            for (const key of nextKeys) {
                if (currentKeys.has(key)) continue;
                const sessionId = parseServerScopedSessionKey(mutation.serverId, key);
                if (sessionId) changes.push({ sessionId, pinned: true });
            }
            for (const key of currentKeys) {
                if (nextKeys.has(key)) continue;
                const sessionId = parseServerScopedSessionKey(mutation.serverId, key);
                if (sessionId) changes.push({ sessionId, pinned: false });
            }
            await Promise.all(changes.map((change) => setSessionOrganizationPin({
                ...mutation,
                sessionId: change.sessionId,
                pinned: change.pinned,
                sortKey: change.sortKey,
            })));
        });
    }, [getOrganizationMutationContext, pinnedKeyList, runOrganizationMutation]);

    const setSessionTagsV1 = React.useCallback((nextTagsRaw: Record<string, readonly string[]>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const keys = new Set([...Object.keys(sessionTagsV1 ?? {}), ...Object.keys(nextTagsRaw ?? {})]);
            const changes: Array<{ sessionId: string; tagIds: string[] }> = [];
            for (const key of keys) {
                const sessionId = parseServerScopedSessionKey(mutation.serverId, key);
                if (!sessionId) continue;
                const current = normalizeStringArray(sessionTagsV1?.[key]);
                const next = normalizeStringArray(nextTagsRaw?.[key]);
                if (current.length === next.length && current.every((value, index) => value === next[index])) continue;
                changes.push({ sessionId, tagIds: next });
            }
            await Promise.all(changes.map((change) => setSessionOrganizationTagLabels({
                ...mutation,
                sessionId: change.sessionId,
                tags: change.tagIds,
            })));
        });
    }, [getOrganizationMutationContext, runOrganizationMutation, sessionTagsV1]);

    const setSessionListGroupOrderV1 = React.useCallback((nextOrder: Record<string, readonly string[] | undefined>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const requests = Object.entries(nextOrder ?? {})
                .map(([scopeKey, itemKeys]) => buildSessionOrganizationReorderRequestFromGroupOrder({
                    serverId: mutation.serverId,
                    scopeKey,
                    itemKeys: itemKeys ?? [],
                }))
                .filter((request): request is NonNullable<typeof request> => request != null);
            await Promise.all(requests.map((request) => reorderSessionOrganization({ ...mutation, request })));
        });
    }, [getOrganizationMutationContext, runOrganizationMutation]);

    const setSessionWorkspaceOrderV1 = React.useCallback((nextOrder: Record<string, readonly string[] | undefined>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const requests = Object.entries(nextOrder ?? {})
                .map(([scopeKey, itemKeys]) => buildSessionOrganizationReorderRequestFromWorkspaceOrder({
                    serverId: mutation.serverId,
                    scopeKey,
                    itemKeys: itemKeys ?? [],
                }))
                .filter((request): request is NonNullable<typeof request> => request != null);
            await Promise.all(requests.map((request) => reorderSessionOrganization({ ...mutation, request })));
        });
    }, [getOrganizationMutationContext, runOrganizationMutation]);

    const setSessionFoldersV1 = React.useCallback((nextFolders: SessionFoldersV1) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const currentById = new Map((sessionFoldersV1.folders ?? []).map((folder) => [folder.id, folder]));
            const nextById = new Map((nextFolders.folders ?? []).map((folder) => [folder.id, folder]));
            const tasks: Promise<void>[] = [];
            for (const folder of nextById.values()) {
                const current = currentById.get(folder.id);
                if (current && areFolderDefinitionsEqual(current, folder)) continue;
                tasks.push(upsertSessionOrganizationFolder({
                    ...mutation,
                    request: {
                        folderId: folder.id,
                        folderKey: folder.id,
                        parentFolderId: folder.parentId,
                        parentFolderKey: folder.parentId,
                        sortKey: folder.sortKey ?? null,
                        display: buildFolderDisplay(folder),
                    },
                }));
            }
            for (const folder of currentById.values()) {
                if (nextById.has(folder.id)) continue;
                tasks.push(deleteSessionOrganizationFolder({
                    ...mutation,
                    request: {
                        folderId: folder.id,
                        assignmentBehavior: 'moveAssignmentsToParent',
                    },
                }));
            }
            await Promise.all(tasks);
        });
    }, [getOrganizationMutationContext, runOrganizationMutation, sessionFoldersV1]);

    const setWorkspaceLabelsV1 = React.useCallback((nextLabelsRaw: Record<string, string>) => {
        runOrganizationMutation(async () => {
            const mutation = await getOrganizationMutationContext();
            if (!mutation) return;
            const keys = new Set([...Object.keys(workspaceLabelsV1 ?? {}), ...Object.keys(nextLabelsRaw ?? {})]);
            const tasks: Promise<void>[] = [];
            for (const keyRaw of keys) {
                const scopeKey = typeof keyRaw === 'string' ? keyRaw.trim() : '';
                if (!scopeKey) continue;
                const current = typeof workspaceLabelsV1?.[scopeKey] === 'string'
                    ? workspaceLabelsV1[scopeKey].trim()
                    : '';
                const next = typeof nextLabelsRaw?.[scopeKey] === 'string'
                    ? nextLabelsRaw[scopeKey].trim()
                    : '';
                if (current === next) continue;
                if (next) {
                    tasks.push(upsertSessionOrganizationLabel({
                        ...mutation,
                        request: {
                            labelKind: 'workspace',
                            scopeKey,
                            display: { t: 'plain', v: { label: next } },
                        },
                    }));
                } else {
                    tasks.push(deleteSessionOrganizationLabel({
                        ...mutation,
                        request: {
                            labelKind: 'workspace',
                            scopeKey,
                        },
                    }));
                }
            }
            await Promise.all(tasks);
        });
    }, [getOrganizationMutationContext, runOrganizationMutation, workspaceLabelsV1]);

    // The agent picker above the list (SessionsListStorageChrome) picks the one agent whose sessions the
    // list shows, and the agent `+` on a folder starts.
    const sessionListAgentSelection = React.useMemo(
        () => resolveSessionListAgentSelection(sessionListAgentFilter, data ?? []),
        [data, sessionListAgentFilter],
    );
    const agentFilteredData = React.useMemo(() => {
        if (!data || !sessionListAgentSelection) return data;
        return filterSessionListViewDataByAgent(data, sessionListAgentSelection);
    }, [data, sessionListAgentSelection]);

    const headerFiltersActive = hasActiveSessionListHeaderFilters(headerFilters);

    // The machines are the active server's; rows name their server, which is that one in a single-server list.
    const explorerServerId = React.useMemo(
        () => activeOrganizationServerId ?? data?.find((item) => item.serverId)?.serverId ?? '',
        [activeOrganizationServerId, data],
    );
    const explorerMachines = React.useMemo((): SessionExplorerMachine[] => explorerMachineSummaries.map((machine) => ({
        serverId: explorerServerId,
        machineId: machine.machineId,
        label: machine.label,
        homeDir: machine.homeDir,
        online: machine.online,
        agentsHosted: machine.agentsHosted,
    })), [explorerMachineSummaries, explorerServerId]);
    const explorerPreviousItemsRef = React.useRef<ReadonlyArray<SessionListViewItem> | null>(null);
    const explorer = React.useMemo(() => {
        if (!explorerEnabled || !agentFilteredData) return null;
        return buildSessionExplorerItems({
            items: agentFilteredData,
            machines: explorerMachines,
            defaultServerId: explorerServerId,
            getListing: readExplorerListing,
            collapsedKeys: collapsedGroupKeysV1 ?? {},
            showHidden: explorerShowHidden === true,
            // Searching shows only folders with matching sessions, all open.
            // Search and tag filters narrow sessions; the Files view has none to narrow.
            sessionFoldersOnly: headerFiltersActive && explorerMode === 'sessions',
            title: t('sessionsList.explorerTitle'),
            rootPaths: explorerRootPaths,
            otherLocationsTitle: t('sessionsList.explorerOtherLocations'),
            mode: explorerMode,
            previousItems: explorerPreviousItemsRef.current,
            // Read with the listings: a roots answer bumps the version `readExplorerListing` follows.
            getSharedFolders: readExplorerSharedFolders,
        });
    }, [agentFilteredData, collapsedGroupKeysV1, explorerEnabled, explorerMachines, explorerMode, explorerRootPaths, explorerServerId, explorerShowHidden, headerFiltersActive, readExplorerListing]);
    explorerPreviousItemsRef.current = explorer?.items ?? null;
    const explorerFoldersToList = explorer?.foldersToList ?? EMPTY_EXPLORER_FOLDERS;
    React.useEffect(() => {
        if (explorerFoldersToList.length > 0) requestExplorerListings(explorerFoldersToList);
    }, [explorerFoldersToList]);
    // Changes made on a machine (an agent, a terminal) show within seconds, without pressing Refresh.
    // Only while the list shows: on phones it stays mounted behind an open session.
    useExplorerAutoRefresh(explorer?.openFolders ?? EMPTY_EXPLORER_FOLDERS, explorerEnabled && sessionListSurfaceDataActive);
    const explorerSharedFoldersToAsk = explorer?.sharedFoldersToAsk ?? EMPTY_EXPLORER_MACHINES;
    React.useEffect(() => {
        if (explorerSharedFoldersToAsk.length > 0) requestExplorerSharedFolders(explorerSharedFoldersToAsk);
    }, [explorerSharedFoldersToAsk]);

    const folderPresentedData = React.useMemo(() => {
        if (explorer) return explorer.items;
        if (!agentFilteredData) return agentFilteredData;
        if (!folderViewEnabled) return agentFilteredData;
        return applySessionFoldersToSessionListViewData(agentFilteredData, {
            enabled: true,
            folders: sessionFoldersV1,
            assignmentsBySessionKey: sessionFolderAssignmentsBySessionKey,
        });
    }, [agentFilteredData, explorer, folderViewEnabled, sessionFolderAssignmentsBySessionKey, sessionFoldersV1]);

    const collapsedListItems = React.useMemo(() => {
        return measureSessionListRenderDerivation(
            'ui.sessionsList.render.collapsedFiltering',
            folderPresentedData,
            () => ({ collapsedGroups: countCollapsedSessionListGroups(collapsedGroupKeysV1) }),
            () => {
                // The explorer leaves closed folders out itself, with its own default for each folder.
                if (!folderPresentedData || headerFiltersActive || explorerEnabled) return folderPresentedData;
                return filterCollapsedSessionListItems(folderPresentedData, collapsedGroupKeysV1);
            },
        );
    }, [folderPresentedData, headerFiltersActive, collapsedGroupKeysV1, explorerEnabled]);

    const focusedFolderState = useSessionListFocusedFolderState({
        canInvalidateFocusedFolder: sessionListSurfaceDataActive,
        folderViewEnabled,
        folderPresentedData,
    });

    const focusedListItems = React.useMemo(() => {
        if (!folderViewEnabled || !focusedFolderState.focusedFolderId || !collapsedListItems) return collapsedListItems;
        return filterSessionListItemsByFocusedFolder(collapsedListItems, focusedFolderState.focusedFolderId);
    }, [collapsedListItems, focusedFolderState.focusedFolderId, folderViewEnabled]);

    const selectionScopeBaseListItems = React.useMemo(() => {
        if (!folderViewEnabled || !focusedFolderState.focusedFolderId || !folderPresentedData) return folderPresentedData;
        return filterSessionListItemsByFocusedFolder(folderPresentedData, focusedFolderState.focusedFolderId);
    }, [folderPresentedData, focusedFolderState.focusedFolderId, folderViewEnabled]);

    const selectionScopeListItems = React.useMemo(() => {
        if (!selectionScopeBaseListItems || !headerFilters) return selectionScopeBaseListItems;
        return filterSessionListItemsForHeaderControls(selectionScopeBaseListItems, {
            ...headerFilters,
            sessionTags: sessionTagsV1 ?? {},
        });
    }, [selectionScopeBaseListItems, headerFilters, sessionTagsV1]);

    const filteredListItems = React.useMemo(() => {
        if (!focusedListItems || !headerFilters) return focusedListItems;
        return filterSessionListItemsForHeaderControls(focusedListItems, {
            ...headerFilters,
            sessionTags: sessionTagsV1 ?? {},
        });
    }, [focusedListItems, headerFilters, sessionTagsV1]);

    const folderBreadcrumbRootTitle = React.useMemo(() => {
        if (focusedFolderState.folderBreadcrumbs.length === 0 || !filteredListItems) return null;
        const projectHeader = filteredListItems.find((item): item is Extract<SessionListViewItem, { type: 'header' }> =>
            item.type === 'header' && item.headerKind === 'project'
        );
        return projectHeader?.title ?? null;
    }, [filteredListItems, focusedFolderState.folderBreadcrumbs.length]);

    const reachabilityModelsCacheRef = React.useRef(createSessionListReachabilityModelsCache());
    const reachabilityModels = React.useMemo(() => {
        return measureSessionListRenderDerivation(
            'ui.sessionsList.render.reachabilityDisplayMap',
            filteredListItems,
            () => ({
                sessions: countSessionListItems(filteredListItems),
                displayRows: countSessionListItems(filteredListItems),
                machines: Object.keys(renderMachineDisplayById).length,
            }),
            () => buildSessionListReachabilityModels({
                cache: reachabilityModelsCacheRef.current,
                items: filteredListItems,
                machinesById: renderMachineDisplayById,
                workspaceLabelsV1,
            }),
        );
    }, [filteredListItems, renderMachineDisplayById, workspaceLabelsV1]);

    const selectedItemsRef = React.useRef<ReadonlyArray<SessionListSelectedItem> | null>(null);
    const visibleListItems = React.useMemo(() => {
        return measureSessionListRenderDerivation(
            'ui.sessionsList.render.selectedMapping',
            filteredListItems,
            () => ({ selectable: selectable ? 1 : 0 }),
            () => buildSessionListSelectedItems({
                items: filteredListItems,
                pathname,
                selectable,
                previousItems: selectedItemsRef.current,
            }),
        );
    }, [filteredListItems, pathname, selectable]);
    selectedItemsRef.current = visibleListItems ?? null;

    const sessionListIndexRef = React.useRef<ReadonlyArray<SessionListIndexItem>>([]);
    const sessionListIndex = React.useMemo(() => {
        return buildSessionListIndexFromViewData(
            (visibleListItems ?? []) as ReadonlyArray<SessionListViewItem>,
            sessionListIndexRef.current,
        ) ?? [];
    }, [visibleListItems]);
    sessionListIndexRef.current = sessionListIndex;

    return {
        pinnedKeyList,
        pinnedKeySet,
        setPinnedSessionKeysV1,
        attentionStandingEnabled: attentionStanding.actionEnabled,
        attentionStandingPolicy: attentionStanding.policy,
        sessionMruOrderV1,
        setSessionMruOrderV1,
        sessionListGroupOrderV1,
        setSessionListGroupOrderV1,
        currentGroupOrderMap,
        sessionWorkspaceOrderV1,
        setSessionWorkspaceOrderV1,
        currentWorkspaceOrderMap,
        sessionFolderViewMode,
        setSessionFolderViewModeV1,
        sessionListOrderingMode,
        setSessionListOrderingModeV1,
        sessionListSavedFolderSortMode,
        sessionListFolderSortMode,
        setSessionListFolderSortModeV1,
        sessionFoldersV1,
        setSessionFoldersV1,
        sessionTagsV1,
        setSessionTagsV1,
        sessionTagsEnabled,
        hideInactiveSessions,
        setHideInactiveSessions,
        rememberLastProjectSessionSelections,
        workspaceLabelsV1,
        setWorkspaceLabelsV1,
        workspaceFaviconsEnabled,
        workspaceMachineSubtitlesEnabled,
        collapsedGroupKeysV1,
        setCollapsedGroupKeysV1,
        compactSessionView,
        compactSessionViewMinimal,
        currentUserId,
        selection,
        showServerBadge,
        showPinnedServerBadge,
        selectable,
        folderActionsEnabled,
        folderViewEnabled,
        explorerEnabled,
        explorerOpenFolders: explorer?.openFolders ?? EMPTY_EXPLORER_FOLDERS,
        explorerShowHidden: explorerShowHidden === true,
        setExplorerShowHidden,
        explorerMode,
        setExplorerMode,
        explorerMachines,
        explorerRootPaths,
        setExplorerRootPaths,
        sessionListAgentSelection,
        allKnownTags,
        folderPresentedData,
        collapsedListItems,
        selectionScopeListItems,
        focusedListItems: filteredListItems,
        visibleListItems,
        listItems: (visibleListItems ?? []) as Array<SessionListViewItem | (Extract<SessionListViewItem, { type: 'session' }> & { selected?: boolean })>,
        sessionListIndex,
        sessionListIndexRef,
        reachabilityModels,
        hasMultipleMachines: reachabilityModels.hasMultipleMachines,
        reachableSessionDisplayByKey: reachabilityModels.reachableSessionDisplayByKey,
        sessionFolderAssignmentsBySessionKey,
        folderBreadcrumbRootTitle,
        ...focusedFolderState,
    };
}
