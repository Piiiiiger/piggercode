
import type { AttachmentDraft } from '@/components/sessions/attachments/attachmentDraftModel';
import { SessionHeaderView } from '@/components/sessions/shell/SessionHeaderView';
import { SessionHeaderActionMenu } from '@/components/sessions/actions/SessionHeaderActionMenu';
import { resolveSessionHeaderActionTargetPx, SESSION_HEADER_ICON_SIZE_PX } from '@/components/sessions/actions/sessionHeaderIconMetrics';
import { SessionHeaderInfoButton } from '@/components/sessions/actions/SessionHeaderInfoButton';
import { ActionOperationActivityButton } from '@/components/inbox/actionOperations/ActionOperationActivityButton';
import { PANE_ACTION_RAIL_WIDTH } from '@/components/appShell/panes/PaneActionRailContext';
import { useAppPaneActionRailVisible } from '@/components/appShell/panes/hooks/useAppPaneActionRailVisible';
import { useSessionCockpitChromeRegistration } from '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry';
import { SessionHeaderTerminalButton } from '@/components/sessions/actions/SessionHeaderTerminalButton';
import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { useEndpointConnectivity, useIsDataReady, useLaunchSelectionMachines, useLocalSetting, useSessionOrganizationProjection, useSetting, useSyncError } from '@/sync/domains/state/storage';
import { getAgentCore, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { resolveAgentIdFromSessionMetadata } from '@piggercode/agents';
import { Session } from '@/sync/domains/state/storageTypes';
import { sync } from '@/sync/sync';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { shadowLevelStyle } from '@/shadowElevation';
import { t, type TranslationKey } from '@/text';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/platform/responsive';
import { getSessionAvatarId, getSessionName } from '@/utils/sessions/sessionUtils';
import { readDisplayMachineTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { useSessionMachineControlTarget, useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import { useSurfaceAnchorPathname } from '@/components/sessions/shell/surface/sessionSurfaceAnchorPathname';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { forgetSessionViewContentWidthSurface } from '@/components/sessions/shell/resolveSessionViewContentBottomSpacing';
import type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';
import { createSyncBackedSubmitPort } from '@/sync/domains/session/input/syncBackedSubmitPort';
import { resolveSessionWorkspacePresentation } from '@/sync/domains/session/listing/sessionWorkspacePresentation';
import { usePathname, useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { Keyboard, Platform, View, useWindowDimensions } from 'react-native';
import { ActivitySpinner, HERO_SPINNER_SIZE } from '@/components/ui/feedback/ActivitySpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { Text } from '@/components/ui/text/Text';
import { useRegisterSessionPaneDriver } from '@/components/sessions/panes/useRegisterSessionPaneDriver';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { SessionScreenTestIdsProvider } from './sessionScreenTestIds';
import { useSessionScreenIsFocused } from './useSessionScreenIsFocused';
import { resolveMobileWorkspaceExperienceToggleActionId } from '@/components/workspaceCockpit/mobileWorkspaceExperience';
import { useMobileWorkspaceExperienceState } from '@/components/workspaceCockpit/useMobileWorkspaceExperienceState';
import type { SessionPaneUrlState } from '@/components/sessions/panes/url/sessionPaneUrlState';
import { NativeTerminalSessionContent } from '@/components/sessions/nativeTerminal/NativeTerminalSessionContent';
import { AppPaneScopeHost } from '@/components/appShell/panes/AppPaneScopeHost';
import { useSessionPaneUrlSync } from '@/components/sessions/panes/url/useSessionPaneUrlSync';
import { useDirectSessionRuntime } from '@/components/sessions/model/useDirectSessionRuntime';
import { SessionDirectSessionRuntimeProvider } from '@/components/sessions/model/useSessionDirectSessionRuntime';
import { SessionWarningActionBanner } from './SessionWarningActionBanner';
import {
    sessionRunnerRuntimeStatusRetention as sessionRunnerRuntimeStatusRetentionStore,
    type SessionRunnerRuntimeStatusIdentity,
    type SessionRunnerRuntimeStatusSnapshot,
} from '@/sync/domains/sessionRunnerRuntime/sessionRunnerRuntimeStatusRetention';
import { getSessionRunnerRuntimeStatus } from '@/sync/ops/sessionRunnerRestart';
import { useAuth } from '@/auth/context/AuthContext';
import { readDirectSessionLink } from '@/sync/domains/session/directSessions/readDirectSessionLink';
import { selectSyncErrorForServer } from '@/sync/runtime/connectivity/syncErrorScope';
import { useSessionViewShellSession, useSessionViewShellSessionSeq } from './sessionViewStableSession';
import { useSessionViewedLifecycle } from './view/useSessionViewedLifecycle';
import { useSessionSurfaceActivation } from './view/useSessionSurfaceActivation';
import { resolveSessionAuthSurfaceState } from './sessionAuthSurfaceState';
import { Icon } from '@/components/ui/icons/Icon';

const sessionSubmitPort = createSyncBackedSubmitPort(sync);

function isOwnedSessionRootPathname(pathname: string | null | undefined, sessionId: string): boolean {
    const normalizedPathname = typeof pathname === 'string' ? pathname.trim() : '';
    if (!normalizedPathname) {
        return false;
    }

    const match = /^\/session\/([^/]+)\/?$/.exec(normalizedPathname);
    if (!match) {
        return false;
    }

    try {
        return decodeURIComponent(match[1] ?? '') === sessionId;
    } catch {
        return false;
    }
}

function isOwnedSessionRoutePathname(pathname: string | null | undefined, sessionId: string): boolean {
    const normalizedPathname = typeof pathname === 'string' ? pathname.trim().split('?')[0] ?? '' : '';
    if (!normalizedPathname) {
        return false;
    }

    const match = /^\/session\/([^/]+)(?:\/.*)?$/.exec(normalizedPathname);
    if (!match) {
        return false;
    }

    try {
        return decodeURIComponent(match[1] ?? '') === sessionId;
    } catch {
        return false;
    }
}

function SessionAuthRecoveryBanner({ message, style }: Readonly<{
    message: string;
    style?: React.ComponentProps<typeof SessionWarningActionBanner>['style'];
}>) {
    const router = useRouter();

    return (
        <SessionWarningActionBanner
            testID="session-auth-sync-error"
            actionTestID="session-auth-sync-error-restore"
            title={t('connect.restoreAccount')}
            body={message}
            actionLabel={t('connect.restoreAccount')}
            actionAccessibilityLabel={t('connect.restoreAccount')}
            onActionPress={() => router.push('/restore')}
            style={style}
        />
    );
}

type SessionHeaderRightElementProps = Readonly<{
    sessionId: string;
    session: Session;
    directSessionRuntime: ReturnType<typeof useDirectSessionRuntime>;
    paneScopeId: string;
    currentSessionRouteServerId: string;
    mobileWorkspaceExperienceToggleActionId: string;
    mobileWorkspaceExperienceToggleLabelKey: TranslationKey | null;
    onToggleWorkspaceExperience: () => void;
    shouldFoldHeaderIconActions: boolean;
    onOpenSessionInfo: () => void;
    showWorkspaceExperienceToggle: boolean;
}>;

const SessionHeaderRightElement = React.memo(function SessionHeaderRightElement(props: SessionHeaderRightElementProps) {
    const { theme } = useUnistyles();
    const actionRailVisible = useAppPaneActionRailVisible(props.paneScopeId);
    const cockpitChrome = useSessionCockpitChromeRegistration();
    const cockpitOwnsSession = cockpitChrome?.sessionId === props.sessionId;
    const cockpitHasTerminal = cockpitOwnsSession && cockpitChrome.terminalTabAvailable;
    const handleHeaderExtraItemSelect = React.useCallback((actionId: string) => {
        if (actionId === props.mobileWorkspaceExperienceToggleActionId) {
            if (actionId === 'header.openMobileWorkspaceCockpit') {
                Keyboard.dismiss();
            }
            props.onToggleWorkspaceExperience();
            return true;
        }
        return false;
    }, [props.mobileWorkspaceExperienceToggleActionId, props.onToggleWorkspaceExperience]);

    const headerExtraItems = React.useMemo(() => {
        const items: DropdownMenuItem[] = [];
        if (props.showWorkspaceExperienceToggle && props.mobileWorkspaceExperienceToggleLabelKey) {
            items.push({
                id: props.mobileWorkspaceExperienceToggleActionId,
                title: t(props.mobileWorkspaceExperienceToggleLabelKey),
                icon: <Icon name="device-mobile" size={16} color={theme.colors.text.secondary} />,
            });
        }
        return items;
    }, [
        props.mobileWorkspaceExperienceToggleActionId,
        props.mobileWorkspaceExperienceToggleLabelKey,
        props.showWorkspaceExperienceToggle,
        theme.colors.text.secondary,
    ]);

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActionOperationActivityButton
                preferredSessionId={props.sessionId}
                testID="session-header-action-operations"
                buttonSize={resolveSessionHeaderActionTargetPx()}
                iconSize={SESSION_HEADER_ICON_SIZE_PX}
            />
            <SessionHeaderActionMenu
                sessionId={props.sessionId}
                session={props.session}
                extraItems={headerExtraItems.length > 0 ? headerExtraItems : undefined}
                onSelectExtraItem={handleHeaderExtraItemSelect}
            />
            {!actionRailVisible && !cockpitHasTerminal ? (
                <SessionHeaderTerminalButton
                    sessionId={props.sessionId}
                    scopeId={props.paneScopeId}
                    serverId={props.currentSessionRouteServerId}
                />
            ) : null}
{/* Never folded. Session details used to be reachable by pressing the avatar, which was
                shown on every width; moving that navigation to an icon that folds below 520pt would
                delete the only path to it on phones rather than tidy the row. */}
            <SessionHeaderInfoButton onPress={props.onOpenSessionInfo} />
        </View>
    );
});

function SessionAuthRecoveryFallback({ message }: Readonly<{ message: string }>) {
    return (
        <View
            testID="session-auth-required-fallback"
            style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 24,
            }}
        >
            <View style={{ width: '100%', maxWidth: 420 }}>
                <SessionAuthRecoveryBanner message={message} />
            </View>
        </View>
    );
}

function resolveRouteHydrationRetryStatusKey(
    cause: Extract<SessionRouteHydrationState, { kind: 'retrying' }>['cause'],
): TranslationKey | null {
    if (cause === 'network' || cause === 'server_unavailable') {
        return 'newSession.notConnectedToServer';
    }
    if (cause === 'decrypting') {
        return 'common.loading';
    }
    return null;
}

function useSessionRunnerRuntimeStatusRetention(input: Readonly<{
    enabled: boolean;
    serverId: string;
    session: Session | null;
}>): Readonly<{
    machineId: string | null;
    status: SessionRunnerRuntimeStatusSnapshot | null;
    invalidateAndRefresh: () => void;
}> {
    const sessionId = input.session?.id ?? '';
    const controlMachineTarget = useSessionMachineControlTarget(sessionId);
    const reachableMachineTarget = useSessionMachineTarget(sessionId);
    const rawMachineId = controlMachineTarget?.machineId
        ?? reachableMachineTarget?.machineId
        ?? input.session?.metadata?.machineId;
    const machineId = typeof rawMachineId === 'string' && rawMachineId.trim()
        ? rawMachineId.trim()
        : null;
    const identity = React.useMemo<SessionRunnerRuntimeStatusIdentity | null>(() => (
        input.enabled && sessionId && machineId
            ? {
                serverId: input.serverId,
                machineId,
                sessionId,
            }
            : null
    ), [input.enabled, input.serverId, machineId, sessionId]);
    const requestRevisionRef = React.useRef(0);
    const [refreshRevision, setRefreshRevision] = React.useState(0);
    const [, setStatusRevision] = React.useState(0);

    const status = identity ? sessionRunnerRuntimeStatusRetentionStore.read(identity) : null;
    const invalidateAndRefresh = React.useCallback(() => {
        if (!identity) return;
        requestRevisionRef.current += 1;
        setRefreshRevision((revision) => revision + 1);
    }, [identity]);

    React.useEffect(() => {
        if (!identity || !machineId || !sessionId) return;

        let cancelled = false;
        const requestRevision = requestRevisionRef.current;
        const refresh = sessionRunnerRuntimeStatusRetentionStore.beginRefresh(identity);
        void getSessionRunnerRuntimeStatus({
            sessionId,
            machineId,
            serverId: input.serverId,
        }).then((state) => {
            if (cancelled || requestRevision !== requestRevisionRef.current) return;
            sessionRunnerRuntimeStatusRetentionStore.completeRefresh(refresh, state);
            setStatusRevision((revision) => revision + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [
        identity,
        input.serverId,
        machineId,
        refreshRevision,
        sessionId,
    ]);

    return {
        machineId,
        status,
        invalidateAndRefresh,
    };
}

type SessionViewProps = Readonly<{
    id: string;
    routeServerId?: string | null;
    routeHydrationState?: SessionRouteHydrationState | null;
    jumpToSeq?: number | null;
    paneUrlState?: SessionPaneUrlState | null;
    initialAttachmentDrafts?: readonly AttachmentDraft[] | null;
    routeAnchorOverride?: boolean | null;
    contentOverride?: React.ReactNode;
    safeAreaTopMode?: 'internal' | 'external';
    headerSafeAreaTopMode?: 'internal' | 'external';
    surfaceFocusedOverride?: boolean | null;
    chatBottomSpacing?: 'default' | 'none';
}>;

export const SessionView = React.memo((props: SessionViewProps) => {
    const sessionId = props.id;
    const router = useRouter();
    const pathname = usePathname();
    const debugRouterEnabled = process.env.EXPO_PUBLIC_DEBUG === '1';
    const auth = useAuth();
    const credentials = auth.credentials;
    const routeHydrationState = props.routeHydrationState ?? null;
    const expectedRouteServerId = routeHydrationState?.serverId ?? props.routeServerId ?? null;
    const session = useSessionViewShellSession(sessionId, expectedRouteServerId);
    const routeHydrationInFlight =
        routeHydrationState?.kind === 'loading' ||
        routeHydrationState?.kind === 'retrying';
    const routeHydrationLoading = !session && routeHydrationState?.kind === 'loading';
    const routeHydrationRetrying = !session && routeHydrationState?.kind === 'retrying';
    const routeHydrationPending = routeHydrationLoading || routeHydrationRetrying;
    const routeHydrationRetryStatusKey = routeHydrationRetrying
        ? resolveRouteHydrationRetryStatusKey(routeHydrationState.cause)
        : null;
    const routeHydrationTerminalMissing = !session && routeHydrationState?.kind === 'missing';
    const stableSessionForLoadedView = session;
    const stableSessionForHeader = session;
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const explicitRouteServerId = (routeHydrationState?.serverId ?? props.routeServerId ?? '').trim();
    const currentSessionRouteServerId =
        explicitRouteServerId
        || resolveServerIdForSessionIdFromLocalCache(sessionId)
        || getActiveServerSnapshot().serverId;
    const executionRunsEnabled = useFeatureEnabled('execution.runs', {
        scopeKind: 'spawn',
        serverId: currentSessionRouteServerId,
    });
    const mobileWorkspaceExperienceState = useMobileWorkspaceExperienceState();
    const handleBackPress = React.useCallback(() => {
        safeRouterBack({
            router,
            fallbackHref: '/',
        });
    }, [router]);
    const safeArea = useSafeAreaInsets();
    const safeAreaTopInset = props.safeAreaTopMode === 'external' ? 0 : safeArea.top;
    const headerSafeAreaTopMode = props.headerSafeAreaTopMode ?? props.safeAreaTopMode ?? 'internal';
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();
    const { width: windowWidth } = useWindowDimensions();
    const isTablet = useIsTablet();
    const hasAuthCredentials = Boolean(credentials);
    const routeFocused = useSessionScreenIsFocused();
    const surfaceFocused = typeof props.surfaceFocusedOverride === 'boolean'
        ? props.surfaceFocusedOverride
        : routeFocused;
    const anchorPathname = useSurfaceAnchorPathname(pathname);
    const isRouteAnchor = typeof props.routeAnchorOverride === 'boolean'
        ? props.routeAnchorOverride
        : isOwnedSessionRoutePathname(anchorPathname, sessionId);
    const shouldRenderSessionSurface = surfaceFocused || isRouteAnchor;
    const shouldRetainSessionSurface = Platform.OS === 'web' ? shouldRenderSessionSurface : true;
    const directSessionRuntime = useDirectSessionRuntime({
        sessionId,
        metadata: session?.metadata ?? null,
        enabled: Boolean(session && shouldRenderSessionSurface),
    });
    const sessionRunnerRuntimeStatusRetention = useSessionRunnerRuntimeStatusRetention({
        enabled: Boolean(session && shouldRenderSessionSurface),
        serverId: currentSessionRouteServerId,
        session,
    });
    useSessionSurfaceActivation({
        sessionId,
        serverId: currentSessionRouteServerId,
        onSessionVisible: stableSessionForLoadedView && shouldRenderSessionSurface
            ? sync.onSessionVisible
            : undefined,
        surfaceFocused,
        surfaceRetained: shouldRetainSessionSurface,
        surfaceVisible: shouldRenderSessionSurface,
    });
    const endpointConnectivity =
        typeof useEndpointConnectivity === 'function'
            ? useEndpointConnectivity()
            : {
                status: 'idle' as const,
                reason: null,
                attempt: 0,
                nextRetryAt: null,
                lastConnectedAt: null,
                lastDisconnectedAt: null,
                lastErrorMessage: null,
            };
    const syncError = useSyncError();
    const allMachines = useLaunchSelectionMachines();
    const machinesById = React.useMemo(() => {
        const next: Record<string, (typeof allMachines)[number]> = {};
        for (const machine of allMachines) {
            next[machine.id] = machine;
        }
        return next;
    }, [allMachines]);
    const sessionOrganizationProjection = useSessionOrganizationProjection(currentSessionRouteServerId);
    const organizationListViewState = React.useMemo(() => buildSessionOrganizationListViewState({
        serverId: currentSessionRouteServerId,
        projection: sessionOrganizationProjection,
    }), [currentSessionRouteServerId, sessionOrganizationProjection]);
    const workspaceLabelsV1 = organizationListViewState.workspaceLabelsV1;
    const workspacePathDisplayModeV1 = useSetting('workspacePathDisplayModeV1');
    const sessionWorkspacePresentation = React.useMemo(() => {
        if (!stableSessionForHeader) return null;
        return resolveSessionWorkspacePresentation({
            metadata: stableSessionForHeader.metadata ?? null,
            machines: machinesById,
            target: readDisplayMachineTargetForSession({
                sessionId: stableSessionForHeader.id,
                metadata: stableSessionForHeader.metadata ?? null,
            }),
            workspaceLabelsV1,
            workspacePathDisplayModeV1,
        });
    }, [machinesById, stableSessionForHeader, workspaceLabelsV1, workspacePathDisplayModeV1]);
    const sessionEncryptionMode: 'e2ee' | 'plain' = (session?.encryptionMode ?? 'e2ee');
    const isEncryptedSessionLocked = Boolean(session && sessionEncryptionMode === 'e2ee' && !hasAuthCredentials);
    const showTopHeader = !(isLandscape && deviceType === 'phone' && Platform.OS !== 'web');
    const paneUrlSyncRouteActive = surfaceFocused && isOwnedSessionRootPathname(pathname, sessionId);
    const scopedSyncError = React.useMemo(() => {
        return selectSyncErrorForServer(syncError, currentSessionRouteServerId);
    }, [currentSessionRouteServerId, syncError]);
    const authSurfaceState = React.useMemo(() => {
        return resolveSessionAuthSurfaceState({
            endpointStatus: endpointConnectivity.status,
            syncError: scopedSyncError,
        });
    }, [endpointConnectivity.status, scopedSyncError]);
    const buildCurrentSessionHref = React.useCallback((suffix = '') => {
        return buildScopedSessionRouteHref({
            sessionId,
            serverId: currentSessionRouteServerId,
            suffix,
        });
    }, [currentSessionRouteServerId, sessionId]);
    const routerRef = React.useRef(router);
    routerRef.current = router;

    // Treat multi-pane panels as enabled unless explicitly disabled. `useLocalSetting` can return
    // `undefined` during hydration; failing closed here causes deep links like `?right=git` to be
    // ignored and makes the UI feel broken on first load.
    const multiPaneEnabled = useLocalSetting('uiMultiPanePanelsEnabled') !== false;
    const paneScopeId = useRegisterSessionPaneDriver(sessionId);
    const actionRailVisible = useAppPaneActionRailVisible(paneScopeId);
    const pane = useAppPaneScope(paneScopeId);
    const sessionsRightPaneDefaultOpen = useLocalSetting('sessionsRightPaneDefaultOpen');
    const paneUrlState = props.paneUrlState ?? null;

    useSessionPaneUrlSync({
        enabled: paneUrlSyncRouteActive && multiPaneEnabled && Platform.OS === 'web',
        scopeKey: paneScopeId,
        scopeState: pane.scopeState,
        urlState: paneUrlState,
        pane,
        setParams: typeof (router as any)?.setParams === 'function' ? (router as any).setParams.bind(router) : null,
    });

    // Session preference: optionally open the right sidebar by default (files tab) when
    // entering a session for the first time on this device.
    React.useEffect(() => {
        if (!sessionsRightPaneDefaultOpen) return;
        if (!multiPaneEnabled) return;
        if (!(Platform.OS === 'web' || deviceType === 'tablet')) return;
        if (paneUrlState?.rightTabId) return;
        const right = (pane.scopeState as any)?.right ?? null;
        if (!right) return;
        if (right.isOpen === true) return;
        // If the user previously opened any right-pane tab in this session, don't override their choice
        // (even if they closed the pane after).
        if (right.activeTabId !== null && right.activeTabId !== undefined) return;
        pane.openRight({ tabId: 'files' });
        pane.setRightTab('files');
    }, [
        deviceType,
        multiPaneEnabled,
        pane,
        pane.scopeState,
        paneUrlState?.rightTabId,
        sessionsRightPaneDefaultOpen,
    ]);
    // Stable identity for THIS pane mount (not the session): `useId` is allocated by the outer
    // SessionView, which survives the inner `key={sessionId}` remount, so the seeded content width
    // persists across session switches in the same pane while staying isolated between panes.
    const contentWidthSurfaceId = React.useId();
    // Release the seeded width when this pane mount unmounts (the cleanup only runs when the outer
    // SessionView goes away, not on session switch), so the seed cache does not grow unbounded.
    React.useEffect(() => {
        return () => {
            forgetSessionViewContentWidthSurface(contentWidthSurfaceId);
        };
    }, [contentWidthSurfaceId]);

    const constrainHeaderWidth = !(multiPaneEnabled
        && Platform.OS === 'web'
        && ((pane.scopeState?.right.isOpen ?? false) || (pane.scopeState?.details.isOpen ?? false)));

    const mobileWorkspaceExperienceToggleActionId = React.useMemo(
        () => resolveMobileWorkspaceExperienceToggleActionId(mobileWorkspaceExperienceState.mobileWorkspaceExperience),
        [mobileWorkspaceExperienceState.mobileWorkspaceExperience],
    );
    const toggleWorkspaceExperienceRef = React.useRef(mobileWorkspaceExperienceState.toggleWorkspaceExperience);
    toggleWorkspaceExperienceRef.current = mobileWorkspaceExperienceState.toggleWorkspaceExperience;

    const handleToggleWorkspaceExperience = React.useCallback(() => {
        toggleWorkspaceExperienceRef.current();
    }, []);
    const shouldFoldHeaderIconActions = windowWidth < 520;

    // Compute header props based on session state
    const headerProps = useMemo(() => {
        if (!shouldRenderSessionSurface) {
            return {
                title: '',
                subtitle: undefined,
                avatarId: undefined,
                agentId: undefined,
                rightElement: undefined,
                isConnected: false,
                flavor: null
            };
        }

        if ((!isDataReady && !session) || routeHydrationPending) {
            // Loading state - show empty header
            return {
                title: '',
                subtitle: undefined,
                avatarId: undefined,
                agentId: undefined,
                rightElement: undefined,
                isConnected: false,
                flavor: null
            };
        }

        if (!session && (routeHydrationTerminalMissing || !routeHydrationState)) {
            // Deleted state - show deleted message in header
            return {
                title: t('errors.sessionDeleted'),
                subtitle: undefined,
                avatarId: undefined,
                agentId: undefined,
                rightElement: undefined,
                isConnected: false,
                flavor: null
            };
        }

        // Normal state - show session info
        const headerSession = stableSessionForHeader ?? session;
        if (!headerSession) {
            return {
                title: t('common.loading'),
                subtitle: undefined,
                avatarId: undefined,
                agentId: undefined,
                rightElement: undefined,
                isConnected: false,
                flavor: null
            };
        }
        const isConnected = headerSession.presence === 'online';
        const directSessionLink = readDirectSessionLink(headerSession.metadata);
        const storageBadge = directSessionLink ? t('sessionsList.storageDirectTab') : t('sessionsList.storagePersistedTab');
        const providerBadge = directSessionLink
            ? [
                t(getAgentCore(directSessionLink.providerId).displayNameKey),
                typeof headerSession.metadata?.host === 'string' && headerSession.metadata.host.trim()
                    ? headerSession.metadata.host.trim()
                    : directSessionLink.machineId,
            ].join(' · ')
            : null;
        const openSessionInfo = () => routerRef.current.navigate(buildCurrentSessionHref('/info') as any, {
            dangerouslySingular() {
                return 'session-info';
            },
        } as any);
        const rightElement = (
            <SessionHeaderRightElement
                sessionId={sessionId}
                session={headerSession}
                directSessionRuntime={directSessionRuntime}
                paneScopeId={paneScopeId}
                currentSessionRouteServerId={currentSessionRouteServerId}
                mobileWorkspaceExperienceToggleActionId={mobileWorkspaceExperienceToggleActionId}
                mobileWorkspaceExperienceToggleLabelKey={mobileWorkspaceExperienceState.workspaceExperienceToggleLabelKey}
                onToggleWorkspaceExperience={handleToggleWorkspaceExperience}
                shouldFoldHeaderIconActions={shouldFoldHeaderIconActions}
                onOpenSessionInfo={openSessionInfo}
                showWorkspaceExperienceToggle={mobileWorkspaceExperienceState.showWorkspaceExperienceToggle}
            />
        );
        return {
            title: getSessionName(headerSession),
            subtitle: sessionWorkspacePresentation?.displayTitle || undefined,
            subtitleEllipsizeMode: sessionWorkspacePresentation?.displayPath && !sessionWorkspacePresentation.hasCustomLabel ? 'head' as const : undefined,
            avatarId: getSessionAvatarId(headerSession),
            agentId: resolveAgentIdFromSessionMetadata(headerSession.metadata)
                ?? resolveAgentIdFromFlavor(headerSession.metadata?.flavor ?? null),
	            rightElement,
	            badges: providerBadge ? [storageBadge, providerBadge] : [storageBadge],
	            isConnected: isConnected,
	            flavor: headerSession.metadata?.flavor || null,
	        };
	    }, [
        directSessionRuntime,
        handleToggleWorkspaceExperience,
        isDataReady,
        mobileWorkspaceExperienceState.showWorkspaceExperienceToggle,
        mobileWorkspaceExperienceState.workspaceExperienceToggleLabelKey,
        mobileWorkspaceExperienceToggleActionId,
        paneScopeId,
        routeHydrationPending,
        routeHydrationState,
        routeHydrationTerminalMissing,
        stableSessionForHeader,
        sessionWorkspacePresentation,
        sessionId,
        shouldRenderSessionSurface,
        shouldFoldHeaderIconActions,
    ]);

    // Every session shows its CLI's own terminal, with the session panes (git, files, details) beside it.
    const normalSessionContent = session && shouldRenderSessionSurface
        ? (props.contentOverride ?? (
            <AppPaneScopeHost
                scopeId={paneScopeId}
                main={<NativeTerminalSessionContent sessionId={sessionId} serverId={currentSessionRouteServerId ?? null} />}
            />
        ))
        : null;
    return (
        <SessionDirectSessionRuntimeProvider value={directSessionRuntime}>
        <SessionScreenTestIdsProvider enabled={surfaceFocused}>
            {session && shouldRenderSessionSurface ? (
                <SessionContentOverrideViewedLifecycle
                    sessionId={sessionId}
                    serverId={session.serverId ?? currentSessionRouteServerId}
                    surfaceFocused={shouldRenderSessionSurface}
                />
            ) : null}
            {debugRouterEnabled && Platform.OS === 'web' ? (
                <View
                    testID="debug-expo-pathname"
                    style={{ position: 'absolute', top: 0, left: 0, opacity: 0, pointerEvents: 'none' }}
                >
                    <Text>{pathname}</Text>
                </View>
            ) : null}
            {/* Status bar shadow for landscape mode */}
            {isLandscape && deviceType === 'phone' && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: safeArea.top,
                    backgroundColor: theme.colors.surface.base,
                    zIndex: 1000,
                    ...shadowLevelStyle(theme.colors.shadowLevels[3]),
                }} />
            )}

            {/* Header - always shown on desktop/Mac, hidden in landscape mode only on actual phones */}
            {showTopHeader && shouldRenderSessionSurface && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 1000
                }}>
                    <SessionHeaderView
                        {...headerProps}
                        onBackPress={handleBackPress}
                        showBackButton={!isTablet}
                        constrainWidth={constrainHeaderWidth}
                        contentTrailingInsetPx={actionRailVisible ? PANE_ACTION_RAIL_WIDTH : 0}
                        includeTopInset={headerSafeAreaTopMode !== 'external'}
                    />
                </View>
            )}

            {/* Content based on state */}
            <View style={{ flex: 1, paddingTop: showTopHeader ? safeAreaTopInset + headerHeight : 0 }}>
                {!session && authSurfaceState ? (
                    <SessionAuthRecoveryFallback message={authSurfaceState.message} />
                ) : routeHydrationRetrying ? (
                    <View testID="session-route-retrying" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
                        <ActivitySpinner size={HERO_SPINNER_SIZE} color={theme.colors.text.secondary} />
                        {routeHydrationRetryStatusKey ? (
                            <Text style={{ color: theme.colors.text.secondary, marginTop: 10, textAlign: 'center' }}>
                                {t(routeHydrationRetryStatusKey)}
                            </Text>
                        ) : null}
                    </View>
                ) : ((!isDataReady && !session) || routeHydrationLoading) ? (
                    // Loading state
                    <View testID="session-route-loading" style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivitySpinner size={HERO_SPINNER_SIZE} color={theme.colors.text.secondary} />
                    </View>
                ) : !session && (routeHydrationTerminalMissing || !routeHydrationState) ? (
                    // Deleted state
                    <View testID="session-root-unavailable" style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Icon name="trash" size={48} color={theme.colors.text.secondary} />
                        <Text style={{ color: theme.colors.text.primary, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
                        <Text style={{ color: theme.colors.text.secondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                  ) : normalSessionContent}
            </View>
        </SessionScreenTestIdsProvider>
        </SessionDirectSessionRuntimeProvider>
    );
});

function SessionContentOverrideViewedLifecycle({
    sessionId,
    serverId,
    surfaceFocused,
}: Readonly<{
    sessionId: string;
    serverId: string | null;
    surfaceFocused: boolean;
}>) {
    const sessionSeq = useSessionViewShellSessionSeq(sessionId);
    useSessionViewedLifecycle({
        sessionId,
        serverId,
        surfaceFocused,
        visibleReadSeq: sessionSeq,
    });
    return null;
}
