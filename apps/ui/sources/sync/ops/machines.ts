/**
 * Machine operations for remote procedure calls
 */

import type {
    MachineUpdateMetadataRequest,
    MachineUpdateMetadataResponse,
    SpawnSessionResult,
} from '@piggercode/protocol';
import { MACHINE_RPC_POLL_INTERVAL_MS } from './machineRpcPollInterval';
import {
    SPAWN_SESSION_ERROR_CODES,
    isSpawnSessionErrorDetail,
    settleSpawnSessionNonce,
    type SpawnSessionErrorCode,
    type SpawnSessionErrorDetail,
} from '@piggercode/protocol';
import { RPC_ERROR_CODES, RPC_METHODS, isRpcMethodNotFoundResult } from '@piggercode/protocol/rpc';

import { apiSocket } from '../api/session/apiSocket';
import type { MachineMetadata } from '../domains/state/storageTypes';
import {
    buildSpawnHappySessionRpcParams,
    type SpawnHappySessionRpcParams,
    type SpawnSessionOptions,
} from '../domains/session/spawn/spawnSessionPayload';
import { readSpawnSessionRpcTimeoutMsFromEnv } from '../domains/session/spawn/spawnSessionRpcTimeout';
import { createSpawnAttemptKeyForFreshSpawnOptions } from '../domains/session/spawn/spawnAttemptKey';
import {
    acquireSpawnAttemptCustody,
    clearSpawnAttemptCustody,
    markSpawnAttemptSessionCreated,
    normalizeSpawnUserAttemptId,
    resetUnreadableSpawnAttemptCustody,
    type PersistedSpawnAttempt,
} from '../domains/session/spawn/spawnAttemptNonceStore';
import { createUiSessionSpawnUserAttemptId } from '../domains/session/spawn/spawnSessionNonce';
import { storage } from '../domains/state/storage';
import { machineStartsNativeTerminalSessions } from '../domains/machines/readMachineDaemonCliVersionForServerScope';
import { isPlainObject, normalizeSpawnSessionResult } from './_shared';
import { isSocketIoAckTimeoutError } from '@/sync/runtime/socketIoAckTimeout';
import { mergeMachineMetadataForVersionMismatch } from './machineMetadataMerge';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { isMachineRpcTimeoutError } from '@/sync/runtime/orchestration/serverScopedRpc/machineRpcTimeoutError';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { readRpcErrorCode } from '@piggercode/protocol/rpcErrors';
import {
    FolderShareListResponseSchema,
    FolderShareMutationResponseSchema,
    MachineCommandSettingsResponseSchema,
    type FolderShare,
    type FolderShareErrorCode,
} from '@piggercode/protocol';
import { stopSessionViaDaemonMachineRpc } from './sessionStopStrategy';
import {
    MACHINE_ENCRYPT_RAW_ATTRIBUTION_EVENTS,
    measureMachineEncryptRawAttribution,
} from '@/sync/encryption/machineEncryption';
import { prepareAccountSettingsForDaemonSpawnIfNeeded } from './accountSettingsDaemonSpawnPreparation';
import { isAccountSettingsScopeChangedDuringSpawnPreparationError } from '@/sync/engine/settings/accountSettingsSpawnPreparationError';
import { delay } from '@/utils/timing/time';
import { ConnectedServiceAuthSelectionUnsupportedError, machineRpcWithConnectedServiceAuthAdmission, requireMachineConnectedServiceAuthSelection } from './connectedServiceAuthSupport';

export type { SpawnHappySessionRpcParams, SpawnSessionOptions } from '../domains/session/spawn/spawnSessionPayload';
export { buildSpawnHappySessionRpcParams } from '../domains/session/spawn/spawnSessionPayload';

export type MachineSpawnSessionResolveStatus =
    | { status: 'success'; sessionId: string }
    | { status: 'error'; errorCode: SpawnSessionErrorCode; errorMessage: string; errorDetail?: SpawnSessionErrorDetail }
    | { status: 'pending' }
    | { status: 'not_found' }
    | { status: 'unsupported' }
    | { status: 'transport_error' };

export type MachineSpawnAttemptCustody =
    | Readonly<{
        status: 'unresolved';
        userAttemptId: string;
        spawnNonce: string;
        targetFingerprint: string;
        createdSessionId: string | null;
        firstTurnLocalId: string;
        attachmentMessageLocalId: string;
    }>
    | Readonly<{
        status: 'completed';
        userAttemptId: string;
        spawnNonce: string;
        targetFingerprint: string;
        createdSessionId: string;
        firstTurnLocalId: string;
        attachmentMessageLocalId: string;
    }>
    | Readonly<{ status: 'corrupt' }>
    | Readonly<{ status: 'lock_unavailable' }>;

export type MachineSpawnNewSessionUntilResolvedResult =
    | (SpawnSessionResult & Readonly<{
        spawnAttemptCustody?: MachineSpawnAttemptCustody;
        pendingFirstInputTransferred?: boolean;
    }>)
    | (Extract<SpawnSessionResult, { type: 'error' }> & Readonly<{
        spawnNonce: string;
        spawnAttemptCustody: Extract<MachineSpawnAttemptCustody, { status: 'unresolved' }>;
    }>);

export type MachineSpawnNewSessionResult = MachineSpawnNewSessionUntilResolvedResult;

const DEFAULT_MACHINE_SPAWN_NONCE_RESOLUTION_POLL_INTERVAL_MS = MACHINE_RPC_POLL_INTERVAL_MS;

function readAuthoritativeMachineHomeDir(params: Readonly<{
    machineId: string;
    effectiveServerId: string;
    activeServerId: string;
}>): string | null {
    const state = storage.getState();
    const machineId = params.machineId.trim();
    const machine = params.effectiveServerId === params.activeServerId
        ? state.machines[machineId]
        : state.machineListByServerId[params.effectiveServerId]?.find((candidate) => candidate.id === machineId);
    const homeDir = machine?.metadata?.homeDir;
    return typeof homeDir === 'string' && homeDir.trim() ? homeDir.trim() : null;
}

function resolveSpawnAttemptTargetFingerprint(params: Readonly<{
    options: SpawnSessionOptions;
    effectiveServerId: string;
    activeServerId: string;
}>): string | null {
    const machineHomeDir = readAuthoritativeMachineHomeDir({
        machineId: params.options.machineId,
        effectiveServerId: params.effectiveServerId,
        activeServerId: params.activeServerId,
    });
    if (!machineHomeDir) return null;
    return createSpawnAttemptKeyForFreshSpawnOptions({
        ...params.options,
        serverId: params.effectiveServerId,
    }, machineHomeDir);
}

// Exported session operation functions

/**
 * Spawn a new remote session on a specific machine
 */
export async function machineSpawnNewSession(options: SpawnSessionOptions): Promise<MachineSpawnNewSessionResult> {
    let custody: Readonly<{
        scope: Readonly<{ serverId: string; accountId: string }>;
        machineId: string;
        targetFingerprint: string;
        record: PersistedSpawnAttempt;
        serverId: string | null;
        reused: boolean;
    }> | null = null;
    let spawnSubmitted = false;
    let pendingFirstInputTransferred = false;
    // This must survive into the transport-error recovery branch below. The
    // source recipe itself remains in the RPC payload; this flag only prevents
    // the browser from resolving a target-only custody record as success.
    let requiresDaemonSourceContextValidation = false;
    const clearCustody = async () => {
        if (!custody) return;
        await clearSpawnAttemptCustody({
            scope: custody.scope,
            machineId: custody.machineId,
            targetFingerprint: custody.targetFingerprint,
            userAttemptId: custody.record.userAttemptId,
        });
        custody = null;
    };
    try {
        const { machineId } = options;
        const serverId = typeof options.serverId === 'string' ? options.serverId.trim() : null;
        const profileScope = storage.getState().profileScope;
        if (!profileScope) {
            return {
                type: 'error',
                errorCode: SPAWN_SESSION_ERROR_CODES.ACCOUNT_SCOPE_CHANGED,
                errorMessage: 'Account scope is unavailable for durable session launch recovery.',
            };
        }
        const effectiveServerId = serverId || profileScope.serverId;
        await requireMachineConnectedServiceAuthSelection({
            machineId,
            serverId: effectiveServerId,
            accountId: profileScope.accountId,
            backendTarget: options.backendTarget,
            connectedServices: options.connectedServices,
        });
        const accountSettingsPreparation = typeof options.accountSettingsVersionHint === 'number'
            ? {}
            : await prepareAccountSettingsForDaemonSpawnIfNeeded(options.accountSettingsVersionHint);
        const preparedOptions = {
            ...options,
            ...accountSettingsPreparation,
        };
        // Only a daemon that starts terminals receives a spawn, and every such daemon takes the first prompt.
        pendingFirstInputTransferred = preparedOptions.pendingFirstInput !== undefined;

        if (
            !machineStartsNativeTerminalSessions({
                state: storage.getState(),
                machineId,
                serverId: effectiveServerId,
                activeServerId: profileScope.serverId,
            })
        ) {
            return {
                type: 'error',
                errorCode: SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST,
                errorMessage: 'Update the PiggerCode CLI on this machine to open terminal sessions.',
            };
        }

        // Browser custody deliberately identifies only a target. A reused
        // source-context request therefore must return through the daemon-side
        // creator, which alone can authenticate persisted source lineage.
        requiresDaemonSourceContextValidation = preparedOptions.sourceContext !== undefined;

        const targetFingerprint = resolveSpawnAttemptTargetFingerprint({
            options: preparedOptions,
            effectiveServerId,
            activeServerId: profileScope.serverId,
        });
        if (!targetFingerprint) {
            return {
                type: 'error',
                errorCode: SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST,
                errorMessage: 'The selected machine home directory is unavailable. Refresh the machine list before starting a session.',
            };
        }
        const userAttemptId = normalizeSpawnUserAttemptId(preparedOptions.userAttemptId);
        const acquired = await acquireSpawnAttemptCustody({
            scope: {
                serverId: effectiveServerId,
                accountId: profileScope.accountId,
            },
            machineId,
            targetFingerprint,
            userAttemptId,
            createUserAttemptId: createUiSessionSpawnUserAttemptId,
            seedNonce: preparedOptions.spawnNonce,
            firstTurnLocalId: preparedOptions.firstTurnLocalId,
            attachmentMessageLocalId: preparedOptions.attachmentMessageLocalId,
        });
        if (acquired.status === 'unreadable') {
            return buildSpawnAttemptCustodyError(
                { status: 'corrupt' },
                'Saved launch recovery state is corrupt. No session was started.',
            );
        }
        if (acquired.status === 'lock_unavailable') {
            return buildSpawnAttemptCustodyError(
                { status: 'lock_unavailable' },
                'This browser cannot safely coordinate session launch recovery. No session was started.',
            );
        }
        const activeAttempt = acquired;
        custody = {
            scope: { serverId: effectiveServerId, accountId: profileScope.accountId },
            machineId,
            targetFingerprint,
            record: activeAttempt.record,
            serverId,
            reused: activeAttempt.reused,
        };

        if (
            activeAttempt.reused
            && activeAttempt.record.phase === 'post_spawn'
            && activeAttempt.record.createdSessionId
            && !requiresDaemonSourceContextValidation
        ) {
            return {
                type: 'success',
                sessionId: activeAttempt.record.createdSessionId,
                pendingFirstInputTransferred,
                spawnAttemptCustody: buildSpawnAttemptCustodyIdentity('completed', activeAttempt.record),
            };
        }

        if (activeAttempt.reused && !requiresDaemonSourceContextValidation) {
            const resolved = await machineResolveSpawnSessionByNonceUntilSettled({
                machineId,
                serverId,
                spawnNonce: activeAttempt.record.nonce,
            });
            if (resolved.status === 'success') {
                await markSpawnAttemptSessionCreated({
                    scope: custody.scope,
                    machineId,
                    targetFingerprint,
                    userAttemptId: activeAttempt.record.userAttemptId,
                    createdSessionId: resolved.sessionId,
                });
                const completedCustody = buildSpawnAttemptCustodyIdentity('completed', {
                    ...activeAttempt.record,
                    phase: 'post_spawn',
                    createdSessionId: resolved.sessionId,
                });
                return {
                    type: 'success',
                    sessionId: resolved.sessionId,
                    pendingFirstInputTransferred,
                    spawnAttemptCustody: completedCustody,
                };
            }
            if (resolved.status === 'error') {
                await clearCustody();
                return buildTerminalSpawnResolutionError(resolved);
            }
            if (resolved.status !== 'not_found') {
                return buildPendingSpawnResolutionError(resolved, activeAttempt.record);
            }
            // The current daemon has authoritative knowledge of its tracked children and nonce
            // admissions. After a daemon restart its process-local correlation can legitimately
            // return `not_found` for caller custody created before that restart. Retry the same
            // semantic launch below with the same nonce; never mint a second attempt identity.
        }

        const params = buildSpawnHappySessionRpcParams({ ...preparedOptions, spawnNonce: activeAttempt.record.nonce });
        spawnSubmitted = true;
        const callSpawnRpc = async (method: string) => (
            await machineRpcWithConnectedServiceAuthAdmission<SpawnHappySessionRpcParams>({
                machineId,
                method,
                payload: params,
                serverId,
                accountId: profileScope.accountId,
                timeoutMs: readSpawnSessionRpcTimeoutMsFromEnv(),
            }, {
                backendTarget: preparedOptions.backendTarget,
                connectedServices: preparedOptions.connectedServices,
            })
        );
        const result = await (async () => {
            try {
                return await callSpawnRpc(RPC_METHODS.SPAWN_HAPPY_SESSION_PROVIDER_SAFE);
            } catch (error) {
                const rpcErrorCode = readRpcErrorCode(error);
                if (
                    rpcErrorCode !== RPC_ERROR_CODES.METHOD_NOT_AVAILABLE
                    && rpcErrorCode !== RPC_ERROR_CODES.METHOD_NOT_FOUND
                ) {
                    throw error;
                }
                return await callSpawnRpc(RPC_METHODS.SPAWN_HAPPY_SESSION);
            }
        })();
        const normalized = normalizeSpawnSessionResult(result);
        if (
            normalized.type === 'success'
            && typeof normalized.pendingFirstInputAccepted === 'boolean'
        ) {
            pendingFirstInputTransferred = normalized.pendingFirstInputAccepted;
        }
        const shouldResolve =
            (normalized.type === 'success' && !normalized.sessionId && normalized.sessionIdStatus === 'pending')
            || (normalized.type === 'error' && normalized.errorCode === SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT);
        if (shouldResolve) {
            if (requiresDaemonSourceContextValidation) {
                // The nonce resolver can name a child but does not carry the
                // raw source recipe needed to prove it is this attempt's child.
                return buildPendingSpawnResolutionError({ status: 'pending' }, activeAttempt.record);
            }
            const resolved = await machineResolveSpawnSessionByNonceUntilSettled({
                machineId,
                serverId,
                spawnNonce: activeAttempt.record.nonce,
            });
            if (resolved.status === 'success') {
                await markSpawnAttemptSessionCreated({
                    scope: custody.scope,
                    machineId,
                    targetFingerprint,
                    userAttemptId: activeAttempt.record.userAttemptId,
                    createdSessionId: resolved.sessionId,
                });
                const completedCustody = buildSpawnAttemptCustodyIdentity('completed', {
                    ...activeAttempt.record,
                    phase: 'post_spawn',
                    createdSessionId: resolved.sessionId,
                });
                return {
                    type: 'success',
                    sessionId: resolved.sessionId,
                    pendingFirstInputTransferred,
                    spawnAttemptCustody: completedCustody,
                };
            }
            if (resolved.status === 'error') {
                await clearCustody();
                return buildTerminalSpawnResolutionError(resolved);
            }
            return buildPendingSpawnResolutionError(resolved, activeAttempt.record);
        }
        const completedRecord = normalized.type === 'success' && normalized.sessionId
            ? {
                ...activeAttempt.record,
                phase: 'post_spawn' as const,
                createdSessionId: normalized.sessionId,
            }
            : null;
        if (completedRecord) {
            await markSpawnAttemptSessionCreated({
                scope: custody.scope,
                machineId,
                targetFingerprint,
                userAttemptId: activeAttempt.record.userAttemptId,
                createdSessionId: completedRecord.createdSessionId,
            });
        } else {
            await clearCustody();
        }
        const completedCustody = completedRecord
            ? buildSpawnAttemptCustodyIdentity('completed', completedRecord)
            : null;
        if (normalized.type === 'success') {
            return {
                ...normalized,
                pendingFirstInputTransferred,
                ...(completedCustody ? { spawnAttemptCustody: completedCustody } : {}),
            };
        }
        return normalized;
    } catch (error) {
        if (error instanceof ConnectedServiceAuthSelectionUnsupportedError) {
            await clearCustody();
            return { type: 'error', errorCode: SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST, errorMessage: error.message };
        }
        if (isAccountSettingsScopeChangedDuringSpawnPreparationError(error)) {
            if (!spawnSubmitted) await clearCustody();
            return {
                type: 'error',
                errorCode: SPAWN_SESSION_ERROR_CODES.ACCOUNT_SCOPE_CHANGED,
                errorMessage: 'Account changed while syncing settings. Please retry from the current account.',
            };
        }
        const rpcErrorCode = readRpcErrorCode(error);
        if (rpcErrorCode === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE) {
            await clearCustody();
            return {
                type: 'error',
                errorCode: SPAWN_SESSION_ERROR_CODES.DAEMON_RPC_UNAVAILABLE,
                errorMessage:
                    `Daemon RPC is not available (RPC method not available). ` +
                    `The daemon may be stopped, still starting, or not connected to the server.`,
            };
        }
        if (isSocketIoAckTimeoutError(error) || isMachineRpcTimeoutError(error)) {
            if (custody) {
                if (requiresDaemonSourceContextValidation) {
                    return buildPendingSpawnResolutionError({ status: 'transport_error' }, custody.record);
                }
                const resolved = await machineResolveSpawnSessionByNonceUntilSettled({
                    machineId: custody.machineId,
                    serverId: custody.serverId,
                    spawnNonce: custody.record.nonce,
                });
                if (resolved.status === 'success') {
                    await markSpawnAttemptSessionCreated({
                        scope: custody.scope,
                        machineId: custody.machineId,
                        targetFingerprint: custody.targetFingerprint,
                        userAttemptId: custody.record.userAttemptId,
                        createdSessionId: resolved.sessionId,
                    });
                    const completedCustody = buildSpawnAttemptCustodyIdentity('completed', {
                        ...custody.record,
                        phase: 'post_spawn',
                        createdSessionId: resolved.sessionId,
                    });
                    return {
                        type: 'success',
                        sessionId: resolved.sessionId,
                        pendingFirstInputTransferred,
                        spawnAttemptCustody: completedCustody,
                    };
                }
                if (resolved.status === 'error') {
                    await clearCustody();
                    return buildTerminalSpawnResolutionError(resolved);
                }
                return buildPendingSpawnResolutionError(resolved, custody.record);
            }
            return {
                type: 'error',
                errorCode: SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT,
                errorMessage: 'Session startup timed out',
            };
        }
        if (!spawnSubmitted) await clearCustody();
        return {
            type: 'error',
            errorCode: SPAWN_SESSION_ERROR_CODES.UNEXPECTED,
            errorMessage: error instanceof Error ? error.message : 'Failed to spawn session',
            ...(custody && spawnSubmitted
                ? {
                    spawnNonce: custody.record.nonce,
                    spawnAttemptCustody: buildSpawnAttemptCustodyIdentity('unresolved', custody.record),
                }
                : {}),
        };
    }
}

function buildSpawnAttemptCustodyIdentity(
    status: 'unresolved',
    record: PersistedSpawnAttempt,
): Extract<MachineSpawnAttemptCustody, { status: 'unresolved' }>;
function buildSpawnAttemptCustodyIdentity(
    status: 'completed',
    record: PersistedSpawnAttempt,
): Extract<MachineSpawnAttemptCustody, { status: 'completed' }>;
function buildSpawnAttemptCustodyIdentity(
    status: 'unresolved' | 'completed',
    record: PersistedSpawnAttempt,
): Extract<MachineSpawnAttemptCustody, { status: 'unresolved' | 'completed' }> {
    const identity = {
        userAttemptId: record.userAttemptId,
        spawnNonce: record.nonce,
        targetFingerprint: record.targetFingerprint,
        createdSessionId: record.createdSessionId,
        firstTurnLocalId: record.firstTurnLocalId,
        attachmentMessageLocalId: record.attachmentMessageLocalId,
    };
    if (status === 'unresolved') {
        return { status: 'unresolved', ...identity };
    }
    if (!record.createdSessionId) {
        throw new Error('Completed spawn custody requires a created session id.');
    }
    return {
        status: 'completed',
        ...identity,
        createdSessionId: record.createdSessionId,
    };
}

export async function completeMachineSpawnAttemptCustody(params: Readonly<{
    machineId: string;
    serverId?: string | null;
    custody: Extract<MachineSpawnAttemptCustody, { status: 'completed' }>;
}>): Promise<boolean> {
    const profileScope = storage.getState().profileScope;
    if (!profileScope) return false;
    return await clearSpawnAttemptCustody({
        scope: {
            serverId: typeof params.serverId === 'string' && params.serverId.trim()
                ? params.serverId.trim()
                : profileScope.serverId,
            accountId: profileScope.accountId,
        },
        machineId: params.machineId,
        targetFingerprint: params.custody.targetFingerprint,
        userAttemptId: params.custody.userAttemptId,
    });
}

export async function resetMachineSpawnAttemptCustody(params: Readonly<{
    serverId?: string | null;
}> = {}): Promise<boolean> {
    const profileScope = storage.getState().profileScope;
    if (!profileScope) return false;
    return await resetUnreadableSpawnAttemptCustody({
        serverId: typeof params.serverId === 'string' && params.serverId.trim()
            ? params.serverId.trim()
            : profileScope.serverId,
        accountId: profileScope.accountId,
    });
}

function buildSpawnAttemptCustodyError(
    spawnAttemptCustody: Extract<MachineSpawnAttemptCustody, { status: 'corrupt' | 'lock_unavailable' }>,
    errorMessage: string,
): Extract<MachineSpawnNewSessionUntilResolvedResult, { type: 'error' }> {
    return {
        type: 'error',
        errorCode: SPAWN_SESSION_ERROR_CODES.INVALID_REQUEST,
        errorMessage,
        spawnAttemptCustody,
    };
}

function buildPendingSpawnResolutionError(
    resolution: Exclude<MachineSpawnSessionResolveStatus, { status: 'success' | 'error' }>,
    record: PersistedSpawnAttempt,
): Extract<MachineSpawnNewSessionUntilResolvedResult, { type: 'error' }> {
    return {
        type: 'error',
        errorCode: SPAWN_SESSION_ERROR_CODES.SESSION_WEBHOOK_TIMEOUT,
        spawnNonce: record.nonce,
        spawnAttemptCustody: buildSpawnAttemptCustodyIdentity('unresolved', record),
        errorMessage: (() => {
            switch (resolution.status) {
                case 'pending':
                    return 'Session startup is still pending. Please retry in a moment.';
                case 'unsupported':
                    return 'Session startup is still pending and this daemon cannot resolve the launch attempt.';
                case 'transport_error':
                    return 'Session startup is still pending and the daemon could not be reached to resolve the launch attempt.';
                case 'not_found':
                default:
                    return 'Session startup is still pending before the created session could be confirmed.';
            }
        })(),
    };
}

function buildTerminalSpawnResolutionError(
    resolution: Extract<MachineSpawnSessionResolveStatus, { status: 'error' }>,
): Extract<MachineSpawnNewSessionUntilResolvedResult, { type: 'error' }> {
    return {
        type: 'error',
        errorCode: resolution.errorCode,
        errorMessage: resolution.errorMessage,
        ...(resolution.errorDetail ? { errorDetail: resolution.errorDetail } : {}),
    };
}

export async function machineSpawnNewSessionUntilResolved(
    options: SpawnSessionOptions,
): Promise<MachineSpawnNewSessionUntilResolvedResult> {
    return await machineSpawnNewSession(options);
}

function normalizeMachineSpawnSessionResolveStatus(value: unknown): MachineSpawnSessionResolveStatus {
    if (isRpcMethodNotFoundResult(value)) {
        return { status: 'unsupported' };
    }
    if (!isPlainObject(value)) {
        return { status: 'not_found' };
    }
    if (value.status === 'pending') {
        return { status: 'pending' };
    }
    if (value.status === 'unsupported') {
        return { status: 'unsupported' };
    }
    if (value.status === 'error') {
        const errorCode = typeof value.errorCode === 'string' ? value.errorCode : '';
        const errorMessage = typeof value.errorMessage === 'string' ? value.errorMessage.trim() : '';
        if ((Object.values(SPAWN_SESSION_ERROR_CODES) as string[]).includes(errorCode) && errorMessage) {
            return {
                status: 'error',
                errorCode: errorCode as SpawnSessionErrorCode,
                errorMessage,
                ...(isSpawnSessionErrorDetail(value.errorDetail) ? { errorDetail: value.errorDetail } : {}),
            };
        }
        return { status: 'not_found' };
    }
    if (value.status === 'success' && typeof value.sessionId === 'string' && value.sessionId.trim().length > 0) {
        return { status: 'success', sessionId: value.sessionId.trim() };
    }
    return { status: 'not_found' };
}

export async function machineResolveSpawnSessionByNonce(options: Readonly<{
    machineId: string;
    serverId?: string | null;
    spawnNonce: string;
    timeoutMs?: number;
}>): Promise<MachineSpawnSessionResolveStatus> {
    const spawnNonce = options.spawnNonce.trim();
    if (!spawnNonce) {
        return { status: 'not_found' };
    }

    try {
        const result = await machineRpcWithServerScope<unknown, { spawnNonce: string }>({
            machineId: options.machineId,
            method: RPC_METHODS.DAEMON_SPAWN_SESSION_RESOLVE,
            payload: { spawnNonce },
            serverId: options.serverId ?? null,
            timeoutMs: options.timeoutMs,
        });
        return normalizeMachineSpawnSessionResolveStatus(result);
    } catch (error) {
        const rpcErrorCode = readRpcErrorCode(error);
        if (
            rpcErrorCode === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE
            || rpcErrorCode === RPC_ERROR_CODES.METHOD_NOT_FOUND
        ) {
            return { status: 'unsupported' };
        }
        return { status: 'transport_error' };
    }
}

function normalizeMachineSpawnNonceRecoveryDuration(value: number | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.trunc(value));
}

export async function machineResolveSpawnSessionByNonceUntilSettled(options: Readonly<{
    machineId: string;
    serverId?: string | null;
    spawnNonce: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
}>): Promise<MachineSpawnSessionResolveStatus> {
    const timeoutMs = normalizeMachineSpawnNonceRecoveryDuration(
        options.timeoutMs,
        readSpawnSessionRpcTimeoutMsFromEnv(),
    );
    const pollIntervalMs = normalizeMachineSpawnNonceRecoveryDuration(
        options.pollIntervalMs,
        DEFAULT_MACHINE_SPAWN_NONCE_RESOLUTION_POLL_INTERVAL_MS,
    );
    const settled = await settleSpawnSessionNonce({
        spawnNonce: options.spawnNonce,
        resolve: async (_spawnNonce, remainingTimeoutMs) => {
            const result = await machineResolveSpawnSessionByNonce({
                ...options,
                timeoutMs: remainingTimeoutMs,
            });
            if (result.status === 'transport_error') {
                throw new Error('Spawn nonce resolver transport failure');
            }
            return result;
        },
        timeoutMs,
        pollIntervalMs: Math.max(1, pollIntervalMs),
        sleep: async (ms) => { await delay(ms); },
    });

    if (settled.status === 'timeout') {
        return { status: 'pending' };
    }
    return settled;
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(
    machineId: string,
    options?: Readonly<{ serverId?: string | null }>,
): Promise<{ message: string }> {
    return await machineRpcWithServerScope<{ message: string }, {}>({
        machineId,
        method: RPC_METHODS.STOP_DAEMON,
        payload: {},
        serverId: options?.serverId ?? null,
    });
}

export type MachineStopSessionResult =
    | { ok: true; status: 'stopped' | 'requested' }
    | { ok: false; error: string; errorCode?: string };

export type MachineBashRequest =
    | string
    | Readonly<{
        command?: string;
        argv?: readonly string[];
    }>;

/**
 * Stop an existing session process through the daemon supervising a specific machine.
 */
export async function machineStopSession(
    machineId: string,
    sessionId: string,
    options?: Readonly<{ serverId?: string | null }>,
): Promise<MachineStopSessionResult> {
    const result = await stopSessionViaDaemonMachineRpc({
        machineId,
        sessionId,
        serverId: options?.serverId,
    });
    if (result.type === 'stopped') {
        return { ok: true, status: 'stopped' };
    }
    if (result.type === 'requested') {
        return { ok: true, status: 'requested' };
    }
    if (result.errorCode) {
        return {
            ok: false,
            error: result.message,
            errorCode: result.errorCode,
        };
    }
    return { ok: false, error: result.message };
}

/** The machine's remote-commands switch as the app sees it. */
export type MachineRemoteCommandsState =
    | Readonly<{ status: 'ok'; enabled: boolean }>
    /** The machine can't take the call: its PiggerCode predates the switch, or it just went offline. */
    | Readonly<{ status: 'unavailable' }>
    /** The machine or the relay reported an error (`message` when it gave one). */
    | Readonly<{ status: 'error'; message?: string }>;

/**
 * One call to a machine-scoped feature RPC (remote commands, shared folders): the machine's answer, or
 * `unavailable` when the machine cannot take the call (its PiggerCode predates the method, or it just
 * went offline), or the error the machine or the relay reported.
 */
async function callMachineFeatureRpc(
    machineId: string,
    method: string,
    payload: Readonly<Record<string, unknown>>,
    options?: { serverId?: string | null },
): Promise<
    | Readonly<{ status: 'answered'; result: unknown }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'error'; message?: string }>
> {
    let result: unknown;
    try {
        result = await machineRpcWithServerScope<unknown, Readonly<Record<string, unknown>>>({
            machineId,
            method,
            payload,
            serverId: options?.serverId,
        });
    } catch (error) {
        const code = readRpcErrorCode(error);
        if (code === RPC_ERROR_CODES.METHOD_NOT_AVAILABLE || code === RPC_ERROR_CODES.METHOD_NOT_FOUND) {
            return { status: 'unavailable' };
        }
        return error instanceof Error && error.message ? { status: 'error', message: error.message } : { status: 'error' };
    }
    if (isRpcMethodNotFoundResult(result)) return { status: 'unavailable' };
    return { status: 'answered', result };
}

/** A daemon handler that throws answers with an `{ error }` result rather than a failed call. */
function readMachineHandlerError(result: unknown): Readonly<{ status: 'error'; message?: string }> {
    return isPlainObject(result) && typeof result.error === 'string' && result.error
        ? { status: 'error', message: result.error }
        : { status: 'error' };
}

async function callMachineRemoteCommandsSettings(
    machineId: string,
    method: string,
    payload: Readonly<Record<string, unknown>>,
    options?: { serverId?: string | null },
): Promise<MachineRemoteCommandsState> {
    const call = await callMachineFeatureRpc(machineId, method, payload, options);
    if (call.status !== 'answered') return call;
    const parsed = MachineCommandSettingsResponseSchema.safeParse(call.result);
    if (parsed.success) return { status: 'ok', enabled: parsed.data.remoteCommandsEnabled };
    return readMachineHandlerError(call.result);
}

/** Whether agents on the account's other machines may run commands on this machine. */
export async function machineRemoteCommandsGet(
    machineId: string,
    options?: { serverId?: string | null },
): Promise<MachineRemoteCommandsState> {
    return await callMachineRemoteCommandsSettings(machineId, RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_GET, {}, options);
}

/** Turns the machine's remote-commands switch on or off; returns the state the machine reports. */
export async function machineRemoteCommandsSet(
    machineId: string,
    enabled: boolean,
    options?: { serverId?: string | null },
): Promise<MachineRemoteCommandsState> {
    return await callMachineRemoteCommandsSettings(machineId, RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_SET, { enabled }, options);
}

/** The folders a machine shares with other machines of the account, as the app sees them. */
export type MachineSharedFoldersState =
    | Readonly<{ status: 'ok'; shares: readonly FolderShare[]; unsupported?: string }>
    /** The machine can't take the call: its PiggerCode predates shared folders, or it just went offline. */
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'error'; message?: string }>;

/** After sharing a folder or stopping: the machine's shares, or why nothing changed (`refused`). */
export type MachineSharedFolderChange =
    | Readonly<{ status: 'ok'; shares: readonly FolderShare[] }>
    | Readonly<{ status: 'refused'; errorCode: FolderShareErrorCode; message: string }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'error'; message?: string }>;

export async function machineSharedFoldersList(
    machineId: string,
    options?: { serverId?: string | null },
): Promise<MachineSharedFoldersState> {
    const call = await callMachineFeatureRpc(machineId, RPC_METHODS.DAEMON_FOLDER_SHARE_LIST, {}, options);
    if (call.status !== 'answered') return call;
    const parsed = FolderShareListResponseSchema.safeParse(call.result);
    if (!parsed.success) return readMachineHandlerError(call.result);
    return parsed.data.unsupported
        ? { status: 'ok', shares: parsed.data.shares, unsupported: parsed.data.unsupported }
        : { status: 'ok', shares: parsed.data.shares };
}

/** Shares `folder` (a path on that machine) of the machine with another machine of the account. */
export async function machineSharedFolderAdd(
    machineId: string,
    /** `at`: where it shows on the server, in its home (`~/code`); for a folder already shared there, it moves it. */
    request: Readonly<{ folder: string; serverMachineId: string; at?: string }>,
    options?: { serverId?: string | null },
): Promise<MachineSharedFolderChange> {
    return await changeMachineSharedFolders(machineId, RPC_METHODS.DAEMON_FOLDER_SHARE_ADD, request, options);
}

export async function machineSharedFolderRemove(
    machineId: string,
    request: Readonly<{ folder: string; serverMachineId: string }>,
    options?: { serverId?: string | null },
): Promise<MachineSharedFolderChange> {
    return await changeMachineSharedFolders(machineId, RPC_METHODS.DAEMON_FOLDER_SHARE_REMOVE, request, options);
}

async function changeMachineSharedFolders(
    machineId: string,
    method: string,
    payload: Readonly<Record<string, unknown>>,
    options?: { serverId?: string | null },
): Promise<MachineSharedFolderChange> {
    const call = await callMachineFeatureRpc(machineId, method, payload, options);
    if (call.status !== 'answered') return call;
    const parsed = FolderShareMutationResponseSchema.safeParse(call.result);
    if (!parsed.success) return readMachineHandlerError(call.result);
    return parsed.data.ok
        ? { status: 'ok', shares: parsed.data.shares }
        : { status: 'refused', errorCode: parsed.data.errorCode, message: parsed.data.error };
}

/**
 * Execute a bash command on a specific machine
 */
export async function machineBash(
    machineId: string,
    command: MachineBashRequest,
    cwd: string,
    options?: { serverId?: string | null }
): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}> {
    try {
        const payload = typeof command === 'string' ? { command, cwd } : { ...command, cwd };
        const result = await machineRpcWithServerScope<{
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
        }, {
            command?: string;
            argv?: readonly string[];
            cwd: string;
        }>({
            machineId,
            method: 'bash',
            payload,
            serverId: options?.serverId,
        });
        return result;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1
        };
    }
}

export async function machineCreateDirectory(
    machineId: string,
    path: string,
    options?: { serverId?: string | null },
): Promise<
    | { success: true }
    | { success: false; error: string; errorCode?: string }
> {
    try {
        return await machineRpcWithServerScope<{ success: true } | { success: false; error: string }, { path: string }>({
            machineId,
            method: RPC_METHODS.CREATE_DIRECTORY,
            payload: { path },
            serverId: options?.serverId,
        });
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}

/**
 * Reads a file in one piece, base64 encoded. The machine refuses folders and files above its own read
 * limit (`PIGGERCODE_FILES_READ_MAX_BYTES`, 2.5 MB unless set), so this is for previews, not bulk transfers.
 */
export async function machineReadFile(
    machineId: string,
    path: string,
    options?: { serverId?: string | null },
): Promise<
    | { success: true; contentBase64: string }
    | { success: false; error: string; errorCode?: string }
> {
    try {
        const result = await machineRpcWithServerScope<{ success: true; content: string } | { success: false; error: string }, { path: string }>({
            machineId,
            method: RPC_METHODS.READ_FILE,
            payload: { path },
            serverId: options?.serverId,
        });
        if (!result.success) return result;
        return typeof result.content === 'string'
            ? { success: true, contentBase64: result.content }
            : { success: false, error: 'Unexpected readFile response' };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}

/** Renames or moves a file or folder; refuses when something is already at `to`. */
export async function machineRenamePath(
    machineId: string,
    from: string,
    to: string,
    options?: { serverId?: string | null },
): Promise<
    | { success: true }
    | { success: false; error: string; errorCode?: string }
> {
    try {
        return await machineRpcWithServerScope<{ success: true } | { success: false; error: string }, { from: string; to: string; overwrite: boolean }>({
            machineId,
            method: RPC_METHODS.RENAME_PATH,
            payload: { from, to, overwrite: false },
            serverId: options?.serverId,
        });
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}

/** Deletes a file, or a folder with everything in it when `recursive` is set. */
export async function machineDeletePath(
    machineId: string,
    path: string,
    options?: { serverId?: string | null; recursive?: boolean },
): Promise<
    | { success: true }
    | { success: false; error: string; errorCode?: string }
> {
    try {
        return await machineRpcWithServerScope<{ success: true } | { success: false; error: string }, { path: string; recursive: boolean }>({
            machineId,
            method: RPC_METHODS.DELETE_PATH,
            payload: { path, recursive: options?.recursive === true },
            serverId: options?.serverId,
        });
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}

export type EnvPreviewSecretsPolicy = 'none' | 'redacted' | 'full';

export type PreviewEnvSensitivitySource = 'forced' | 'hinted' | 'none';

export interface PreviewEnvValue {
    value: string | null;
    isSet: boolean;
    isSensitive: boolean;
    isForcedSensitive: boolean;
    sensitivitySource: PreviewEnvSensitivitySource;
    display: 'full' | 'redacted' | 'hidden' | 'unset';
}

export interface PreviewEnvResponse {
    policy: EnvPreviewSecretsPolicy;
    values: Record<string, PreviewEnvValue>;
}

interface PreviewEnvRequest {
    keys: string[];
    extraEnv?: Record<string, string>;
    sensitiveKeys?: string[];
}

export type MachinePreviewEnvResult =
    | { supported: true; response: PreviewEnvResponse }
    | { supported: false };

export type BugReportCollectDiagnosticsResult = {
    daemonState: {
        pid: number;
        httpPort: number;
        startedAt: number;
        startedWithCliVersion: string;
        hasControlToken: boolean;
        daemonLogPath: string | null;
    } | null;
    daemonLogs: Array<{ file: string; path: string; modifiedAt: string }>;
    runtime: { cwd: string; platform: string; nodeVersion: string };
    stackContext?: {
        stackName: string | null;
        stackEnvPath: string | null;
        runtimeStatePath: string | null;
        runtimeState: string | null;
        logCandidates: string[];
    } | null;
};

export type BugReportLogTailResult =
    | { ok: true; path: string; tail: string }
    | { ok: false; error: string };


/**
 * Preview environment variables exactly as the daemon will spawn them.
 *
 * This calls the daemon's `preview-env` RPC (if supported). The daemon computes:
 * - effective env = { ...daemon.process.env, ...expand(extraEnv) }
 * - applies `PIGGERCODE_ENV_PREVIEW_SECRETS` policy for sensitive variables
 *
 * If the daemon is old and doesn't support `preview-env`, returns `{ supported: false }`.
 */
export async function machinePreviewEnv(
    machineId: string,
    params: PreviewEnvRequest,
    options?: { serverId?: string | null },
): Promise<MachinePreviewEnvResult> {
    try {
        const result = await machineRpcWithServerScope<unknown, PreviewEnvRequest>({
            machineId,
            method: RPC_METHODS.PREVIEW_ENV,
            payload: params,
            serverId: options?.serverId,
        });

        // Older daemons (or errors) return an encrypted `{ error: ... }` payload.
        // Treat method-not-found as “unsupported” and fallback to bash-based probing.
        if (isRpcMethodNotFoundResult(result)) return { supported: false };
        // For any other error, degrade gracefully in UI by using fallback behavior.
        if (isPlainObject(result) && typeof result.error === 'string') return { supported: false };

        // Basic shape validation (be defensive for mixed daemon versions).
        if (
            !isPlainObject(result) ||
            (result.policy !== 'none' && result.policy !== 'redacted' && result.policy !== 'full') ||
            !isPlainObject(result.values)
        ) {
            return { supported: false };
        }

        const response: PreviewEnvResponse = {
            policy: result.policy as EnvPreviewSecretsPolicy,
            values: Object.fromEntries(
                Object.entries(result.values as Record<string, unknown>).map(([k, v]) => {
                    if (!isPlainObject(v)) {
                        const fallback: PreviewEnvValue = {
                            value: null,
                            isSet: false,
                            isSensitive: false,
                            isForcedSensitive: false,
                            sensitivitySource: 'none',
                            display: 'unset',
                        };
                        return [k, fallback] as const;
                    }

                    const display = v.display;
                    const safeDisplay =
                        display === 'full' || display === 'redacted' || display === 'hidden' || display === 'unset'
                            ? display
                            : 'unset';

                    const value = v.value;
                    const safeValue = typeof value === 'string' ? value : null;

                    const isSet = v.isSet;
                    const safeIsSet = typeof isSet === 'boolean' ? isSet : safeValue !== null;

                    const isSensitive = v.isSensitive;
                    const safeIsSensitive = typeof isSensitive === 'boolean' ? isSensitive : false;

                    // Back-compat for intermediate daemons: default to “not forced” if missing.
                    const isForcedSensitive = v.isForcedSensitive;
                    const safeIsForcedSensitive = typeof isForcedSensitive === 'boolean' ? isForcedSensitive : false;

                    const sensitivitySource = v.sensitivitySource;
                    const safeSensitivitySource: PreviewEnvSensitivitySource =
                        sensitivitySource === 'forced' || sensitivitySource === 'hinted' || sensitivitySource === 'none'
                            ? sensitivitySource
                            : (safeIsSensitive ? 'hinted' : 'none');

                    const entry: PreviewEnvValue = {
                        value: safeValue,
                        isSet: safeIsSet,
                        isSensitive: safeIsSensitive,
                        isForcedSensitive: safeIsForcedSensitive,
                        sensitivitySource: safeSensitivitySource,
                        display: safeDisplay,
                    };

                    return [k, entry] as const;
                }),
            ) as Record<string, PreviewEnvValue>,
        };
        return { supported: true, response };
    } catch {
        return { supported: false };
    }
}

export async function machineCollectBugReportDiagnostics(
    machineId: string,
    options?: { timeoutMs?: number },
): Promise<BugReportCollectDiagnosticsResult | null> {
    try {
        return await apiSocket.machineRPC<BugReportCollectDiagnosticsResult, {}>(
            machineId,
            RPC_METHODS.BUGREPORT_COLLECT_DIAGNOSTICS,
            {},
            options,
        );
    } catch {
        return null;
    }
}

export async function machineGetBugReportLogTail(
    machineId: string,
    params?: { path?: string; maxBytes?: number },
    options?: { timeoutMs?: number },
): Promise<BugReportLogTailResult> {
    try {
        return await apiSocket.machineRPC<BugReportLogTailResult, { path?: string; maxBytes?: number }>(
            machineId,
            RPC_METHODS.BUGREPORT_GET_LOG_TAIL,
            {
                path: params?.path,
                maxBytes: params?.maxBytes,
            },
            options,
        );
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to read log tail',
        };
    }
}

export type MachineReadSessionLogTailResult =
    | { success: true; path: string; tail: string; truncated?: boolean }
    | { success: false; error: string; errorCode?: string };

export async function machineReadSessionLogTail(
    machineId: string,
    params: { path: string; maxBytes?: number },
    options?: { timeoutMs?: number },
): Promise<MachineReadSessionLogTailResult> {
    try {
        return await apiSocket.machineRPC<MachineReadSessionLogTailResult, { path: string; maxBytes?: number }>(
            machineId,
            RPC_METHODS.SESSION_LOG_TAIL,
            {
                path: params.path,
                maxBytes: params.maxBytes,
            },
            options,
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to read session log tail',
        };
    }
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
    machineId: string,
    metadata: MachineMetadata,
    expectedVersion: number,
    maxRetries: number = 3
): Promise<{ version: number; metadata: string }> {
    let currentVersion = expectedVersion;
    let currentMetadata = { ...metadata };
    let retryCount = 0;

    const sync = getSyncSingleton();
    const machineEncryption = sync.encryption.getMachineEncryption(machineId);
    if (!machineEncryption) {
        throw new Error(`Machine encryption not found for ${machineId}`);
    }

    while (retryCount < maxRetries) {
        const encryptedMetadata = await measureMachineEncryptRawAttribution(
            MACHINE_ENCRYPT_RAW_ATTRIBUTION_EVENTS.metadataWrite,
            async () => await machineEncryption.encryptRaw(currentMetadata),
        );

        const request = {
            machineId,
            metadata: encryptedMetadata,
            expectedVersion: currentVersion,
        } satisfies MachineUpdateMetadataRequest;
        const result = await apiSocket.emitWithAck<MachineUpdateMetadataResponse>(
            'machine-update-metadata',
            request,
        );

        if (result.result === 'success') {
            const currentMachine = storage.getState().machines[machineId] ?? null;
            if (currentMachine) {
                storage.getState().applyMachines([{
                    ...currentMachine,
                    metadata: currentMetadata,
                    metadataVersion: result.version!,
                }]);
            }
            return {
                version: result.version,
                metadata: result.metadata
            };
        } else if (result.result === 'version-mismatch') {
            // Get the latest version and metadata from the response
            currentVersion = result.version;
            const latestMetadata = await machineEncryption.decryptRaw(result.metadata) as MachineMetadata;

            currentMetadata = mergeMachineMetadataForVersionMismatch({
                latest: latestMetadata,
                intended: currentMetadata,
            });

            retryCount++;

            // If we've exhausted retries, throw error
            if (retryCount >= maxRetries) {
                throw new Error(`Failed to update after ${maxRetries} retries due to version conflicts`);
            }

            // Otherwise, loop will retry with updated version and merged metadata
        } else {
            throw new Error(result.message || 'Failed to update machine metadata');
        }
    }

    throw new Error('Unexpected error in machineUpdateMetadata');
}

/**
 * Abort the current session operation
 */
