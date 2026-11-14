import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { buildNewSessionAuthoringDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';
import type { PermissionMode, ModelMode } from '@/sync/domains/permissions/permissionTypes';
import type { Settings } from '@/sync/domains/settings/settings';
import type { NewSessionAutomationDraft } from '@/sync/domains/automations/automationDraft';
import type { UseMachineEnvPresenceResult } from '@/hooks/machine/useMachineEnvPresence';
import { normalizeSessionAuthoringConnectedServices } from '@/sync/domains/sessionAuthoring/sessionAuthoringNormalization';
import {
    buildBackendTargetKey,
    type SessionMcpSelectionV1,
} from '@piggercode/protocol';
import { AIBackendProfileSchema } from '@/sync/domains/profiles/profileCompatibility';
import { renderScreen } from '@/dev/testkit';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';

import { installNewSessionScreenModelCommonModuleMocks } from './newSessionScreenModelTestHelpers';
import { createNewSessionPromptStore } from '@/components/sessions/new/hooks/screenModel/newSessionPromptStore';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type SpawnPayloadCapture = {
    serverId?: string;
    permissionMode?: string;
    permissionModeUpdatedAt?: number;
    connectedServices?: unknown;
    connectedServicesUpdatedAt?: number;
    mcpSelection?: unknown;
    resume?: string;
    transcriptStorage?: 'persisted' | 'direct';
    windowsRemoteSessionLaunchMode?: 'hidden' | 'windows_terminal' | 'console';
    windowsTerminalWindowName?: string;
    pendingFirstInput?: {
        text: string;
        localId: string;
        meta?: Record<string, unknown>;
    };
} | null;

type AutomationCreateCapture = {
    name: string;
    enabled: boolean;
    schedule: { kind: string; everyMs?: number };
    targetType: 'new_session' | 'existing_session';
    templateCiphertext: string;
    assignments?: Array<{ machineId: string; enabled?: boolean; priority?: number }>;
} | null;

function buildAutomationAuthoringDraft(params: Readonly<{
    prompt: string;
    modelMode: ModelMode;
    permissionMode: PermissionMode;
    automation: NewSessionAutomationDraft;
    connectedServices?: unknown;
    mcpSelection?: SessionMcpSelectionV1 | null;
    transcriptStorage?: 'persisted' | 'direct' | null;
    checkoutCreationDraft?: {
        kind: 'git_worktree';
        displayName: string;
        baseRef: string | null;
    } | null;
    acpSessionModeId?: string | null;
}>){
    return buildNewSessionAuthoringDraft({
        directory: '/tmp',
        checkoutCreationDraft: params.checkoutCreationDraft ?? null,
        prompt: params.prompt,
        displayText: params.prompt,
        agentId: 'codex',
        backendTarget: null,
        transcriptStorage: params.transcriptStorage ?? null,
        profileId: null,
        environmentVariables: null,
        resumeSessionId: null,
        permissionMode: params.permissionMode,
        permissionModeUpdatedAt: null,
        modelId: params.modelMode === 'default' ? null : params.modelMode,
        modelUpdatedAt: null,
        mcpSelection: params.mcpSelection ?? null,
        connectedServices: normalizeSessionAuthoringConnectedServices(params.connectedServices ?? null),
        terminal: null,
        windowsRemoteSessionLaunchMode: null,
        windowsRemoteSessionConsole: null,
        codexBackendMode: null,
        acpSessionModeId: params.acpSessionModeId ?? null,
        sessionConfigOptionOverrides: null,
        automation: params.automation,
    });
}

async function setupUseCreateNewSessionHarness() {
    const captured: { value: SpawnPayloadCapture } = { value: null };
    const buildSpawnEnvironmentVariablesCapture: { value: Record<string, unknown> | null } = { value: null };
    const automationCaptured: { value: AutomationCreateCapture } = { value: null };
    const sessions: Record<string, { id: string }> = {};
    const encryptRawSpy = vi.fn(async (value: unknown) => {
        return `cipher:${Buffer.from(JSON.stringify(value)).toString('base64')}`;
    });
    const modalAlertSpy = vi.fn((..._args: unknown[]) => {});
    const modalConfirmSpy = vi.fn(async () => false);
    const clearNewSessionDraftSpy = vi.fn();
    const setActiveServerSpy = vi.fn((..._args: unknown[]) => {});
    const switchConnectionToActiveServerSpy = vi.fn(async (..._args: unknown[]) => ({ token: 'next-token', secret: 'next-secret' }));
    const refreshMachinesSpy = vi.fn(async () => {});
    const refreshSessionsSpy = vi.fn(async () => {});
    const ensureSessionVisibleForMessageRouteSpy = vi.fn(async (sessionId: string) => {
        sessions[sessionId] = { id: sessionId };
    });
    const refreshAutomationsSpy = vi.fn(async () => {});
    const applySettingsSpy = vi.fn((..._args: unknown[]) => {});
    const updateAutomationSpy = vi.fn(async () => {});
    const updateSessionDraftSpy = vi.fn();
    const markSessionOptimisticThinkingSpy = vi.fn();
    const upsertPendingMessageSpy = vi.fn();
    const saveSessionDraftsSpy = vi.fn();
    const getMachineCapabilitiesSnapshotSpy = vi.fn(() => ({ supported: true, response: { protocolVersion: 1, results: {} } }));
    const prefetchMachineCapabilitiesSpy = vi.fn(async () => {});
    const captureExceptionIfEnabledSpy = vi.fn();
    const syncSendMessageSpy = vi.fn<(...args: unknown[]) => Promise<void>>(async (..._args: unknown[]) => {});
    const sessionGoalSetSpy = vi.fn(async (_sessionId: string, _request: unknown, _opts?: unknown) => ({ ok: true as const }));
    const sessionGoalClearSpy = vi.fn(async (_sessionId: string, _opts?: unknown) => ({ ok: true as const }));
    const actionExecuteSpy = vi.fn(async (_actionId: unknown, _input: unknown, _ctx?: unknown) => ({ ok: true as const }));
    const followUpSpawnedSessionWithServerScopeSpy = vi.fn(async (params: {
        sessionId: string;
        targetServerId?: string | null;
        initialMessageText?: string | null;
        profileId?: string | null;
    }) => {
        const targetServerId = typeof params.targetServerId === 'string' && params.targetServerId.trim().length > 0
            ? params.targetServerId
            : 'server-a';
        if (targetServerId !== 'server-a') {
            return;
        }

        await refreshSessionsSpy();

        if (typeof params.initialMessageText === 'string' && params.initialMessageText.trim().length > 0) {
            await syncSendMessageSpy(
                params.sessionId,
                params.initialMessageText,
                undefined,
                undefined,
                params.profileId ? { profileId: params.profileId } : undefined,
            );
        }
    });
    const materializeNewSessionCheckoutSpy = vi.fn(async () => ({
        success: true as const,
        path: '/tmp/materialized-worktree',
        sessionPath: '/tmp/materialized-worktree',
        repositoryRootPath: '/tmp/materialized-worktree',
    }));
    const machineSpawnNewSessionSpy = vi.fn<(...args: unknown[]) => Promise<any>>(async (...args: unknown[]) => {
        const opts = args[0] as SpawnPayloadCapture;
        captured.value = opts;
        return { type: 'error', errorCode: 'unexpected', errorMessage: 'stop' };
    });
    const machineBashSpy = vi.fn<(...args: unknown[]) => Promise<{
        success: boolean;
        stderr: string;
        stdout: string;
        exitCode: number;
    }>>(async () => ({
        success: true,
        stderr: '',
        stdout: '',
        exitCode: 0,
    }));

    installNewSessionScreenModelCommonModuleMocks({
        text: () =>
            createTextModuleMock({
                translate: (key: string) => key,
            }),
    });
    vi.doMock('@/modal', () => ({
        Modal: {
            alert: modalAlertSpy,
            confirm: modalConfirmSpy,
        },
    }));
    vi.doMock('@/sync/domains/state/storage', () => ({
        storage: {
            getState: () => ({
                settings: {},
                machines: { m1: { id: 'm1' } },
                sessions,
                updateSessionPermissionMode: vi.fn(),
                updateSessionModelMode: vi.fn(),
                updateSessionDraft: updateSessionDraftSpy,
                markSessionOptimisticThinking: markSessionOptimisticThinkingSpy,
                upsertPendingMessage: upsertPendingMessageSpy,
                markSessionResuming: vi.fn(),
                armSessionResumingFallback: vi.fn(),
            }),
        },
    }));
    vi.doMock('@/sync/sync', () => ({
        sync: {
            applySettings: vi.fn(),
            createAutomation: vi.fn(async (input: AutomationCreateCapture) => {
                automationCaptured.value = input;
                return { id: 'auto_1', ...input };
            }),
            updateAutomation: updateAutomationSpy,
            getCredentials: vi.fn(() => ({ token: 't' })),
            encryption: {
                encryptRaw: encryptRawSpy,
                encryptAutomationTemplateRaw: encryptRawSpy,
            },
            decryptSecretValue: vi.fn(),
            refreshAutomations: refreshAutomationsSpy,
            refreshSessions: refreshSessionsSpy,
            ensureSessionVisibleForMessageRoute: ensureSessionVisibleForMessageRouteSpy,
            refreshMachines: refreshMachinesSpy,
            sendMessage: syncSendMessageSpy,
            acquireUserRequestLease: () => () => {},
        },
    }));
    vi.doMock('@/sync/store/settingsWriters', () => ({
        useApplySettings: () => applySettingsSpy,
    }));
    vi.doMock('@/sync/http/client', () => ({
        serverFetch: vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ mode: 'e2ee', updatedAt: 1 }),
        })),
    }));
    vi.doMock('@/sync/domains/state/persistence', () => ({
        getPersistenceStorage: () => ({
            getString: () => undefined,
            set: vi.fn(),
            delete: vi.fn(),
            getAllKeys: () => [],
        }),
        clearNewSessionDraft: clearNewSessionDraftSpy,
        loadChangesCursor: () => null,
        loadAppInstallId: () => null,
        loadLastChangesCursorByAccountId: () => ({}),
        loadNewSessionDraft: () => null,
        loadPendingSettings: () => ({}),
        loadProfile: () => ({}),
        loadSessionActionDrafts: () => ({}),
        loadSessionDrafts: () => ({}),
        loadSessionLastViewed: () => ({}),
        loadSessionMaterializedMaxSeqById: () => ({}),
        loadSessionModelModes: () => ({}),
        loadSessionModelModeUpdatedAts: () => ({}),
        loadSessionPermissionModes: () => ({}),
        loadSessionPermissionModeUpdatedAts: () => ({}),
        loadSessionReviewCommentsDrafts: () => ({}),
        loadSettings: () => ({ settings: {}, version: null }),
        loadThemePreference: () => 'adaptive',
        saveChangesCursor: vi.fn(),
        saveAppInstallId: vi.fn(),
        saveLastChangesCursorByAccountId: vi.fn(),
        saveSettings: vi.fn(),
        saveNewSessionDraft: vi.fn(),
        loadLocalSettings: () => ({}),
        saveLocalSettings: vi.fn(),
        loadPurchases: () => ({}),
        savePurchases: vi.fn(),
        savePendingSettings: vi.fn(),
        saveProfile: vi.fn(),
        saveSessionActionDrafts: vi.fn(),
        saveSessionDrafts: saveSessionDraftsSpy,
        saveSessionLastViewed: vi.fn(),
        saveSessionMaterializedMaxSeqById: vi.fn(),
        saveSessionModelModes: vi.fn(),
        saveSessionModelModeUpdatedAts: vi.fn(),
        saveSessionPermissionModes: vi.fn(),
        saveSessionPermissionModeUpdatedAts: vi.fn(),
        saveSessionReviewCommentsDrafts: vi.fn(),
        clearPersistence: vi.fn(),
    }));
    vi.doMock('@/sync/domains/server/serverRuntime', () => ({
        getActiveServerSnapshot: vi.fn(() => ({
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            kind: 'custom',
            generation: 1,
        })),
        setActiveServer: setActiveServerSpy,
    }));
    vi.doMock('@/sync/domains/server/selection/serverSelectionResolver', () => ({
        resolveNewSessionServerTarget: vi.fn((params: { requestedServerId?: string | null; allowedServerIds: string[] }) => ({
            targetServerId:
                params.requestedServerId && params.allowedServerIds.includes(params.requestedServerId)
                    ? params.requestedServerId
                    : params.allowedServerIds[0] ?? null,
            rejectedRequestedServerId:
                params.requestedServerId && !params.allowedServerIds.includes(params.requestedServerId)
                    ? params.requestedServerId
                    : null,
        })),
    }));
    vi.doMock('@/sync/domains/profiles/profileUtils', () => ({
        getBuiltInProfile: vi.fn(() => null),
    }));
    vi.doMock('@/sync/domains/features/featureLocalPolicy', () => ({
        resolveLocalFeaturePolicyEnabled: vi.fn((featureId: string, settings: { featureToggles?: Record<string, boolean> }) => settings.featureToggles?.[featureId] === true),
    }));
    vi.doMock('@/utils/system/sentry', () => ({
        captureExceptionIfEnabled: captureExceptionIfEnabledSpy,
    }));
    vi.doMock('@/sync/runtime/orchestration/connectionManager', () => ({
        switchConnectionToActiveServer: switchConnectionToActiveServerSpy,
    }));
    vi.doMock('@/sync/domains/settings/terminalSettings', () => ({
        resolveTerminalSpawnOptions: vi.fn(() => null),
    }));
    vi.doMock('@/hooks/server/useMachineCapabilitiesCache', () => ({
        getMachineCapabilitiesSnapshot: getMachineCapabilitiesSnapshotSpy,
        prefetchMachineCapabilities: prefetchMachineCapabilitiesSpy,
    }));
    vi.doMock('@/agents/catalog/catalog', () => ({
        AGENT_IDS: ['codex', 'claude'],
        getAgentCore: vi.fn((agentType: string) => {
            if (agentType === 'claude') {
                return { model: { supportsSelection: true, nonAcpApplyScope: 'next_prompt' } };
            }

            return { model: { supportsSelection: true, nonAcpApplyScope: 'spawn_only' } };
        }),
        buildSpawnEnvironmentVariablesFromUiState: vi.fn((opts: { environmentVariables?: Record<string, string> }) => {
            buildSpawnEnvironmentVariablesCapture.value = opts as Record<string, unknown>;
            return opts.environmentVariables;
        }),
        buildSpawnSessionExtrasFromUiState: vi.fn(() => ({})),
        getAgentResumeExperimentsFromSettings: vi.fn(() => ({})),
        getNewSessionPreflightIssues: vi.fn(() => []),
        buildResumeCapabilityOptionsFromUiState: vi.fn(() => ({})),
    }));
    vi.doMock('@/agents/runtime/resumeCapabilities', () => ({
        canAgentResume: vi.fn(() => false),
    }));
    vi.doMock('@/components/sessions/new/modules/formatResumeSupportDetailCode', () => ({
        formatResumeSupportDetailCode: vi.fn(() => ''),
    }));
    vi.doMock('@/sync/ops', () => ({
        machineSpawnNewSession: (...args: unknown[]) => machineSpawnNewSessionSpy(...args),
        machineBash: (...args: unknown[]) => machineBashSpy(...args),
        completeMachineSpawnAttemptCustody: vi.fn(async () => true),
        resetMachineSpawnAttemptCustody: vi.fn(async () => true),
    }));
    vi.doMock('@/components/sessions/new/modules/materializeNewSessionCheckout', () => ({
        materializeNewSessionCheckout: materializeNewSessionCheckoutSpy,
    }));
    vi.doMock('@/sync/runtime/orchestration/serverScopedRpc/followUpSpawnedSession', async () => {
        const actual = await vi.importActual<typeof import('@/sync/runtime/orchestration/serverScopedRpc/followUpSpawnedSession')>(
            '@/sync/runtime/orchestration/serverScopedRpc/followUpSpawnedSession',
        );
        return {
            ...actual,
            followUpSpawnedSessionWithServerScope: followUpSpawnedSessionWithServerScopeSpy,
        };
    });
    vi.doMock('@/sync/ops/actions/defaultActionExecutor', () => ({
        createDefaultActionExecutor: vi.fn(() => ({
            execute: (actionId: unknown, input: unknown, ctx?: unknown) => actionExecuteSpy(actionId, input, ctx),
        })),
    }));
    vi.doMock('@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache', () => ({
        resolveServerIdForSessionIdFromLocalCache: vi.fn(() => 'server-a'),
    }));

    const { useCreateNewSession } = await import('./useCreateNewSession');
    return {
        useCreateNewSession,
        captured,
        buildSpawnEnvironmentVariablesCapture,
        automationCaptured,
        sessions,
        encryptRawSpy,
        modalAlertSpy,
        modalConfirmSpy,
        clearNewSessionDraftSpy,
        setActiveServerSpy,
        switchConnectionToActiveServerSpy,
        refreshMachinesSpy,
        refreshSessionsSpy,
        ensureSessionVisibleForMessageRouteSpy,
        refreshAutomationsSpy,
        updateAutomationSpy,
        updateSessionDraftSpy,
        markSessionOptimisticThinkingSpy,
        upsertPendingMessageSpy,
        saveSessionDraftsSpy,
        materializeNewSessionCheckoutSpy,
        getMachineCapabilitiesSnapshotSpy,
        prefetchMachineCapabilitiesSpy,
        captureExceptionIfEnabledSpy,
        syncSendMessageSpy,
        sessionGoalSetSpy,
        sessionGoalClearSpy,
        actionExecuteSpy,
        followUpSpawnedSessionWithServerScopeSpy,
        machineSpawnNewSessionSpy,
    };
}

describe('useCreateNewSession permission seeding', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes a canonical permission mode and timestamp into machineSpawnNewSession', async () => {
        const { useCreateNewSession, captured } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-b',
                allowedTargetServerIds: ['server-a', 'server-b'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value).not.toBeNull();
        expect(captured.value?.permissionMode).toBe('safe-yolo');
        expect(typeof captured.value?.permissionModeUpdatedAt).toBe('number');
        expect(Number.isFinite(captured.value?.permissionModeUpdatedAt)).toBe(true);
        expect((captured.value?.permissionModeUpdatedAt ?? 0)).toBeGreaterThan(0);
    });

    it('passes resumeSessionId through without pre-spawn capability probing', async () => {
        const { useCreateNewSession, captured, prefetchMachineCapabilitiesSpy } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'claude' as any,
                permissionMode: 'default' as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: 'sess_old',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-b',
                allowedTargetServerIds: ['server-a', 'server-b'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value?.resume).toBe('sess_old');
        expect(prefetchMachineCapabilitiesSpy).toHaveBeenCalledTimes(0);
    });

    it('hands the first prompt to the daemon, which types it into the terminal, with no chat echo', async () => {
        const {
            useCreateNewSession,
            captured,
            followUpSpawnedSessionWithServerScopeSpy,
            machineSpawnNewSessionSpy,
            markSessionOptimisticThinkingSpy,
            upsertPendingMessageSpy,
        } = await setupUseCreateNewSessionHarness();

        machineSpawnNewSessionSpy.mockImplementationOnce(async (options: unknown) => {
            captured.value = options as SpawnPayloadCapture;
            return { type: 'success', sessionId: 'sess_target', pendingFirstInputTransferred: true };
        });

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: {
                    metadata: {},
                    daemonState: { startedWithCliVersion: '0.2.10' },
                },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'claude' as any,
                permissionMode: 'default' as PermissionMode,
                modelMode: 'gpt' as any,
                promptStore: createNewSessionPromptStore('hello'),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-a',
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value).toEqual(expect.objectContaining({
            pendingFirstInput: {
                text: 'hello',
                localId: expect.stringMatching(/^first-turn-/),
                meta: { model: 'gpt' },
            },
        }));
        expect(followUpSpawnedSessionWithServerScopeSpy).not.toHaveBeenCalled();
        // The terminal shows the prompt as the CLI takes it: nothing is echoed as a chat message.
        expect(markSessionOptimisticThinkingSpy).not.toHaveBeenCalled();
        expect(upsertPendingMessageSpy).not.toHaveBeenCalled();
    });

    it('carries the composer structured-input envelope into the first turn, merged with the model seed', async () => {
        // The new-session composer builds `mentions[]` exactly like the session composer; the first
        // prompt carries the envelope to the daemon. Without it an `@session` reference would reach the
        // agent as bare text.
        const {
            useCreateNewSession,
            followUpSpawnedSessionWithServerScopeSpy,
            machineSpawnNewSessionSpy,
        } = await setupUseCreateNewSessionHarness();

        machineSpawnNewSessionSpy.mockResolvedValueOnce({ type: 'success', sessionId: 'sess_target' });

        let handleCreateSession: null | ((options?: unknown) => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
                draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
                launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'claude' as any,
                permissionMode: 'default' as PermissionMode,
                modelMode: 'gpt' as any,
                promptStore: createNewSessionPromptStore('see @session:peer-abc123 $project-check'),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-a',
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as (options?: unknown) => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        const envelope = {
            v: 1,
            mentions: [{
                kind: 'happier.session',
                ref: 'session:peer',
                token: '@session:peer-abc123',
                start: 4,
                end: 24,
            }, {
                kind: 'happier.skill',
                ref: 'skill:vendor:codex:project-check',
                token: '$project-check',
            }],
        };

        await act(async () => {
            await handleCreateSession?.({
                structuredInputMetaOverrides: { happierStructuredInputV1: envelope },
            });
        });

        expect(machineSpawnNewSessionSpy).toHaveBeenCalledWith(expect.objectContaining({
            pendingFirstInput: expect.objectContaining({
                text: 'see @session:peer-abc123 $project-check',
                meta: {
                    model: 'gpt',
                    happierStructuredInputV1: envelope,
                },
            }),
        }));
        expect(followUpSpawnedSessionWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('passes connectedServices bindings into machineSpawnNewSession when provided', async () => {
        const { useCreateNewSession, captured } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: '',
                agentNewSessionOptions: {
                    connectedServices: {
                        v: 1,
                        bindingsByServiceId: {
                            anthropic: { source: 'connected', profileId: 'work' },
                        },
                    },
                },
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-b',
                allowedTargetServerIds: ['server-a', 'server-b'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value).not.toBeNull();
        expect(captured.value?.connectedServices).toEqual({
            v: 1,
            bindingsByServiceId: {
                anthropic: { source: 'connected', profileId: 'work' },
            },
        });
        expect(typeof captured.value?.connectedServicesUpdatedAt).toBe('number');
        expect(Number.isFinite(captured.value?.connectedServicesUpdatedAt)).toBe(true);
        expect(captured.value?.connectedServicesUpdatedAt).toBe(captured.value?.permissionModeUpdatedAt);
    });

    it('passes mcpSelection into machineSpawnNewSession when provided', async () => {
        const { useCreateNewSession, captured } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'default' as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                mcpSelection: {
                    v: 1,
                    managedServersEnabled: false,
                    forceIncludeServerIds: ['server-portable'],
                    forceExcludeServerIds: [],
                },
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: null,
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value?.mcpSelection).toEqual({
            v: 1,
            managedServersEnabled: false,
            forceIncludeServerIds: ['server-portable'],
            forceExcludeServerIds: [],
        });
    });

    it('passes transcriptStorage through to machineSpawnNewSession when requested', async () => {
        const { useCreateNewSession, captured } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'claude',
                permissionMode: 'default' as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                transcriptStorage: 'direct',
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: null,
                allowedTargetServerIds: ['server-a'],
            } as any);

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value?.transcriptStorage).toBe('direct');
    });

    it('routes spawn to the target server without switching global active server', async () => {
        const {
            useCreateNewSession,
            getMachineCapabilitiesSnapshotSpy,
            captured,
            buildSpawnEnvironmentVariablesCapture,
        } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-b',
                allowedTargetServerIds: ['server-a', 'server-b'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(captured.value?.serverId).toBe('server-b');
        expect(getMachineCapabilitiesSnapshotSpy).toHaveBeenCalledWith('m1', 'server-b');
        expect(buildSpawnEnvironmentVariablesCapture.value).toMatchObject({
            newSessionOptions: {
                targetServerId: 'server-b',
            },
        });
    });

    it('falls back to active server when targetServerId is outside the allowed target server IDs', async () => {
        const {
            useCreateNewSession,
            modalAlertSpy,
            captured,
        } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = { experiments: false } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-c',
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(modalAlertSpy).not.toHaveBeenCalledWith('common.error', 'newSession.serverSelectionUnavailable');
        expect(captured.value).not.toBeNull();
        expect(captured.value?.serverId).toBe('server-a');
    });

    it('passes the selected profile id along with the first prompt of a new profiled session', async () => {
        const {
            useCreateNewSession,
            syncSendMessageSpy,
            machineSpawnNewSessionSpy,
        } = await setupUseCreateNewSessionHarness();

        machineSpawnNewSessionSpy.mockResolvedValueOnce({ type: 'success', sessionId: 'sess_new' });

        let handleCreateSession: null | (() => Promise<void>) = null;
        const routerReplace = vi.fn();
        const settings = {
            experiments: false,
            sessionReplayEnabled: false,
        } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: routerReplace },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: true,
                selectedProfileId: 'profile-test',
                profileMap: new Map([[
                    'profile-test',
                    AIBackendProfileSchema.parse({
                        id: 'profile-test',
                        name: 'Profile Test',
                        description: undefined,
                        environmentVariables: [],
                        envVarRequirements: [],
                        compatibility: {},
                        defaultPermissionModeByAgent: {},
                        defaultPermissionModeByTargetKey: {},
                        defaultPersistenceModeByAgent: {},
                        defaultPersistenceModeByTargetKey: {},
                        compatibilityByTargetKey: {
                            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: true,
                        },
                        isBuiltIn: false,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        version: '1.0.0',
                    }),
                ]]),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore('PROMPT'),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: null,
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(machineSpawnNewSessionSpy).toHaveBeenCalledWith(expect.objectContaining({
            pendingFirstInput: expect.objectContaining({
                text: 'PROMPT',
                meta: expect.objectContaining({ profileId: 'profile-test' }),
            }),
        }));
        expect(syncSendMessageSpy).not.toHaveBeenCalled();
    });

    it('blocks creation when the selected profile is incompatible with the current backend target', async () => {
        const {
            useCreateNewSession,
            modalAlertSpy,
            machineSpawnNewSessionSpy,
            syncSendMessageSpy,
        } = await setupUseCreateNewSessionHarness();

        let handleCreateSession: null | (() => Promise<void>) = null;
        const settings = {
            experiments: false,
            sessionReplayEnabled: false,
        } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: true,
                selectedProfileId: 'profile-test',
                profileMap: new Map([[
                    'profile-test',
                    AIBackendProfileSchema.parse({
                        id: 'profile-test',
                        name: 'Profile Test',
                        description: undefined,
                        environmentVariables: [],
                        envVarRequirements: [],
                        compatibility: {},
                        defaultPermissionModeByAgent: {},
                        defaultPermissionModeByTargetKey: {},
                        defaultPersistenceModeByAgent: {},
                        defaultPersistenceModeByTargetKey: {},
                        compatibilityByTargetKey: {
                            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: true,
                            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: false,
                        },
                        isBuiltIn: false,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        version: '1.0.0',
                    }),
                ]]),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore('PROMPT'),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: null,
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as () => Promise<void>;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.();
        });

        expect(modalAlertSpy).toHaveBeenCalledWith('common.error', 'newSession.aiBackendNotCompatibleWithSelectedProfile');
        expect(machineSpawnNewSessionSpy).not.toHaveBeenCalled();
        expect(syncSendMessageSpy).not.toHaveBeenCalled();
    });

    function renderCreateSessionHook(
        harness: Awaited<ReturnType<typeof setupUseCreateNewSessionHarness>>,
        params: Readonly<{ agentType: 'claude' | 'codex'; machineMetadata: Record<string, unknown>; prompt: string }>,
    ) {
        const handle: { current: null | ((opts?: any) => Promise<void>) } = { current: null };
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };
        function Test() {
            const hook = harness.useCreateNewSession({
                draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
                launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: {
                    metadata: params.machineMetadata,
                    daemonState: { startedWithCliVersion: '0.3.18' },
                },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings: { experiments: false } as unknown as Settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: params.agentType as any,
                permissionMode: 'default' as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(params.prompt),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: 'server-a',
                allowedTargetServerIds: ['server-a'],
            });
            handle.current = hook.handleCreateSession as any;
            return React.createElement('View');
        }
        return { Test, handle };
    }

    it.each(['claude', 'codex'] as const)(
        'starts a %s session as its own CLI in a terminal, typing what was written into it instead of a chat message',
        async (agentType) => {
            const harness = await setupUseCreateNewSessionHarness();
            harness.machineSpawnNewSessionSpy.mockImplementationOnce(async (options: unknown) => {
                harness.captured.value = options as SpawnPayloadCapture;
                return { type: 'success', sessionId: 'sess_terminal', pendingFirstInputTransferred: true };
            });
            const { Test, handle } = renderCreateSessionHook(harness, {
                agentType,
                machineMetadata: { daemonNativeTerminalSessionsSupported: true },
                prompt: 'Fix the login bug',
            });
            await renderScreen(React.createElement(Test));

            await act(async () => {
                await handle.current?.();
            });

            // The spawn RPC builder marks every session a terminal; the first prompt rides along for the CLI.
            expect(harness.captured.value).toEqual(expect.objectContaining({
                pendingFirstInput: expect.objectContaining({ text: 'Fix the login bug' }),
            }));
            expect(harness.markSessionOptimisticThinkingSpy).not.toHaveBeenCalled();
            expect(harness.upsertPendingMessageSpy).not.toHaveBeenCalled();
            expect(harness.followUpSpawnedSessionWithServerScopeSpy).not.toHaveBeenCalled();
        },
    );

    it('can skip sending the initial message when requested', async () => {
        const {
            useCreateNewSession,
            syncSendMessageSpy,
            machineSpawnNewSessionSpy,
        } = await setupUseCreateNewSessionHarness();

        machineSpawnNewSessionSpy.mockResolvedValueOnce({ type: 'success', sessionId: 'sess_new' });

        let handleCreateSession: null | ((opts?: any) => Promise<void>) = null;
        const routerReplace = vi.fn();
        const settings = {
            experiments: false,
            sessionReplayEnabled: false,
        } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: routerReplace },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: {} },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore('PROMPT'),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: null,
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as any;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.({ initialMessage: 'skip' });
        });

        expect(syncSendMessageSpy).toHaveBeenCalledTimes(0);
        expect(routerReplace).toHaveBeenCalledWith('/session/sess_new?serverId=server-a', expect.anything());
    });

    it('passes the per-session Windows launch-mode override into machineSpawnNewSession', async () => {
        const {
            useCreateNewSession,
            captured,
            machineSpawnNewSessionSpy,
        } = await setupUseCreateNewSessionHarness();

        machineSpawnNewSessionSpy.mockImplementationOnce(async (...args: unknown[]) => {
            captured.value = args[0] as SpawnPayloadCapture;
            return { type: 'success', sessionId: 'sess_new' };
        });

        let handleCreateSession: null | ((opts?: any) => Promise<void>) = null;
        const settings = {
            experiments: false,
            sessionWindowsRemoteSessionLaunchMode: 'hidden',
            sessionWindowsTerminalWindowName: 'happier-qa',
        } as unknown as Settings;
        const machineEnvPresence: UseMachineEnvPresenceResult = {
            isPreviewEnvSupported: false,
            isLoading: false,
            meta: {},
            refreshedAt: null,
            refresh: () => {},
        };

        function Test() {
            const hook = useCreateNewSession({
        draftId: '8e0a5dd1-b1df-43dd-b51e-b7787b30362e',
        launchIntentSignature: 'test-launch-intent',
                router: { push: vi.fn(), replace: vi.fn() },
                selectedMachineId: 'm1',
                selectedPath: '/tmp',
                selectedMachine: { metadata: { platform: 'win32', windowsRemoteSessionLaunchMode: 'console' } },
                setIsCreating: vi.fn(),
                setIsResumeSupportChecking: vi.fn(),
                settings,
                useProfiles: false,
                selectedProfileId: null,
                profileMap: new Map(),
                recentMachinePaths: [],
                agentType: 'codex',
                permissionMode: 'acceptEdits' as unknown as PermissionMode,
                modelMode: 'default' as ModelMode,
                promptStore: createNewSessionPromptStore(''),
                resumeSessionId: '',
                agentNewSessionOptions: null,
                windowsRemoteSessionLaunchModeOverride: 'windows_terminal',
                machineEnvPresence,
                secrets: [],
                secretBindingsByProfileId: {},
                selectedSecretIdByProfileIdByEnvVarName: {},
                sessionOnlySecretValueByProfileIdByEnvVarName: {},
                selectedMachineCapabilities: null,
                targetServerId: null,
                allowedTargetServerIds: ['server-a'],
            });

            handleCreateSession = hook.handleCreateSession as any;
            return React.createElement('View');
        }

        await renderScreen(React.createElement(Test));

        await act(async () => {
            await handleCreateSession?.({ initialMessage: 'skip' });
        });

        expect(captured.value?.windowsRemoteSessionLaunchMode).toBe('windows_terminal');
        expect(captured.value?.windowsTerminalWindowName).toBe('happier-qa');
    });
});
