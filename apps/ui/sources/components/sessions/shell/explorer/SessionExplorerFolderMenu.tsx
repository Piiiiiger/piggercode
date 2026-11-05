import * as React from 'react';
import type { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { AgentId } from '@piggercode/agents';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { getAgentCore, isAgentId } from '@/agents/registry/registryCore';
import { ContextMenu } from '@/components/ui/forms/dropdown/ContextMenu';
import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { listSessionListAgentOptions } from '@/sync/domains/session/listing/sessionListAgentFilter';
import { useSessionExplorerMachines } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { useInstalledAgentClis } from './useInstalledAgentClis';

/** What an explorer folder's (or file's) ⋯ and right-click menu offer; a null entry is left out. */
export type SessionExplorerFolderActions = Readonly<{
    /** Starts a session in the folder with the chosen agent (CLI). */
    newSession: Readonly<{
        machineId: string;
        /** The agent the list shows, offered even before the machine's CLIs are detected. */
        preferredAgentId: AgentId | null;
        start: (agentId: AgentId) => void;
    }> | null;
    onNewFolder: (() => void) | null;
    onCopyPath: (() => void) | null;
    onOpenAsTop: (() => void) | null;
    onRefresh: (() => void) | null;
    onRename: (() => void) | null;
    onDelete: (() => void) | null;
    /** Files only: saves the file on this device. */
    onDownload?: (() => void) | null;
}>;

export function hasSessionExplorerFolderActions(actions: SessionExplorerFolderActions | null | undefined): boolean {
    if (!actions) return false;
    return Boolean(actions.newSession || actions.onNewFolder || actions.onCopyPath || actions.onOpenAsTop
        || actions.onRefresh || actions.onRename || actions.onDelete || actions.onDownload);
}

const NEW_SESSION_PREFIX = 'new-session:';
const NO_COUNTS: ReadonlyMap<AgentId, number> = new Map();
const NO_MACHINES: ReturnType<typeof useSessionExplorerMachines> = Object.freeze([]);

/** The agents a session can start with on the folder's machine; detection runs while the menu is open. */
function useNewSessionAgents(newSession: SessionExplorerFolderActions['newSession']): AgentId[] {
    const machines = useSessionExplorerMachines();
    const machineId = newSession?.machineId ?? null;
    const own = React.useMemo(() => machines.filter((machine) => machine.machineId === machineId), [machineId, machines]);
    // A computer that runs no agents starts no sessions: no agents to offer, nothing to detect.
    const startsSessions = machineId != null && !own.some((machine) => !machine.agentsHosted);
    const { installed, detect } = useInstalledAgentClis({ serverId: null, machines: startsSessions ? own : NO_MACHINES });
    React.useEffect(() => {
        if (startsSessions) detect();
    }, [detect, startsSessions]);
    const preferred = newSession?.preferredAgentId ?? null;
    return React.useMemo(
        () => (startsSessions ? listSessionListAgentOptions({ counts: NO_COUNTS, installed, selected: preferred }) : []),
        [installed, preferred, startsSessions],
    );
}

export type SessionExplorerFolderMenuProps = Readonly<{
    /** A folder (the default) or a file of the Files view. */
    kind?: 'folder' | 'file';
    actions: SessionExplorerFolderActions;
    anchorRef: React.RefObject<View | null>;
    placement: 'left' | 'bottom';
    onClose: () => void;
}>;

/**
 * An explorer folder's menu, VS Code style: new session (per agent), new folder, copy path, open as the top
 * folder, refresh, rename and delete. It mounts only while open, so idle rows keep no subscriptions.
 */
export function SessionExplorerFolderMenu(props: SessionExplorerFolderMenuProps) {
    const { theme } = useUnistyles();
    const iconColor = theme.colors.text.secondary;
    const dangerColor = theme.colors.state.danger.foreground;
    const { actions, onClose } = props;
    const isFile = props.kind === 'file';
    const testIdPrefix = isFile ? 'session-explorer-file' : 'session-explorer-folder';
    const agents = useNewSessionAgents(actions.newSession);

    const items = React.useMemo((): DropdownMenuItem[] => {
        const list: DropdownMenuItem[] = [];
        if (actions.newSession && agents.length > 0) {
            const agentItems = agents.map((agentId): DropdownMenuItem => ({
                id: `${NEW_SESSION_PREFIX}${agentId}`,
                testID: `session-explorer-folder-new-session:${agentId}`,
                title: t(getAgentCore(agentId).displayNameKey),
                icon: <AgentIcon agentId={agentId} size={ICON_SIZE.sm} color={iconColor} />,
            }));
            list.push(agentItems.length === 1
                ? { ...agentItems[0]!, title: t('sessionsList.newSessionInFolder') }
                : {
                    id: 'new-session',
                    testID: 'session-explorer-folder-new-session',
                    title: t('sessionsList.newSessionInFolder'),
                    icon: <Icon name="plus" size={ICON_SIZE.sm} color={iconColor} />,
                    submenu: { items: agentItems },
                });
        }
        if (actions.onNewFolder) {
            list.push({
                id: 'new-folder',
                testID: 'session-explorer-folder-new-folder',
                title: t('files.createFolderPromptTitle'),
                icon: <Icon name="folder" size={ICON_SIZE.sm} color={iconColor} />,
            });
        }
        if (actions.onCopyPath) {
            list.push({
                id: 'copy-path',
                testID: `${testIdPrefix}-copy-path`,
                title: t('files.repositoryTree.actions.copyPath'),
                icon: <Icon name="copy" size={ICON_SIZE.sm} color={iconColor} />,
            });
        }
        if (actions.onDownload) {
            list.push({
                id: 'download',
                testID: `${testIdPrefix}-download`,
                title: t('files.repositoryTree.actions.download'),
                icon: <Icon name="download" size={ICON_SIZE.sm} color={iconColor} />,
            });
        }
        if (actions.onOpenAsTop) {
            list.push({
                id: 'open-as-top',
                testID: 'session-explorer-folder-open-as-top',
                title: t('sessionsList.explorerOpenAsTop'),
                icon: <Icon name="folder-open" size={ICON_SIZE.sm} color={iconColor} />,
            });
        }
        if (actions.onRefresh) {
            list.push({
                id: 'refresh',
                testID: 'session-explorer-folder-refresh',
                title: t('common.refresh'),
                icon: <Icon name="arrow-clockwise" size={ICON_SIZE.sm} color={iconColor} />,
            });
        }
        if (actions.onRename) {
            list.push({
                id: 'rename-folder',
                testID: `${testIdPrefix}-rename`,
                title: t('common.rename'),
                icon: <Icon name="pencil-simple" size={ICON_SIZE.sm} color={iconColor} />,
            });
        }
        if (actions.onDelete) {
            list.push({
                id: 'delete-folder',
                testID: `${testIdPrefix}-delete`,
                title: isFile ? t('common.delete') : t('files.repositoryTree.deleteFolder.confirm'),
                icon: <Icon name="trash" size={ICON_SIZE.sm} color={dangerColor} />,
                destructive: true,
            });
        }
        return list;
    }, [actions, agents, dangerColor, iconColor, isFile, testIdPrefix]);

    const handleSelect = React.useCallback((itemId: string) => {
        if (itemId.startsWith(NEW_SESSION_PREFIX)) {
            const agentId = itemId.slice(NEW_SESSION_PREFIX.length);
            if (isAgentId(agentId)) actions.newSession?.start(agentId);
        } else if (itemId === 'new-folder') actions.onNewFolder?.();
        else if (itemId === 'copy-path') actions.onCopyPath?.();
        else if (itemId === 'download') actions.onDownload?.();
        else if (itemId === 'open-as-top') actions.onOpenAsTop?.();
        else if (itemId === 'refresh') actions.onRefresh?.();
        else if (itemId === 'rename-folder') actions.onRename?.();
        else if (itemId === 'delete-folder') actions.onDelete?.();
    }, [actions]);

    const handleOpenChange = React.useCallback((next: boolean) => {
        if (!next) onClose();
    }, [onClose]);

    return (
        <ContextMenu
            open={items.length > 0}
            onOpenChange={handleOpenChange}
            anchorRef={props.anchorRef}
            items={items}
            onSelect={handleSelect}
            placement={props.placement}
            variant="slim"
            maxWidthCap={240}
            popoverPortalWebTarget="body"
        />
    );
}
