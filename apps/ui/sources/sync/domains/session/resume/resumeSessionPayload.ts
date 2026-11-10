import { z } from 'zod';
import {
    BackendTargetRefSchema,
    SessionAttachMetadataIdentityPolicySchema,
    SessionAuthoringValueV1Schema,
    SessionInitialGoalRequestV1Schema,
    SpawnSessionExecutionAuthorizationSchema,
    type SessionAttachMetadataIdentityPolicy,
    type BackendTargetRefV1,
    type SessionInitialGoalRequestV1,
    type SessionAuthoringValueV1,
} from '@piggercode/protocol';
import { SpawnSessionTerminalSchema } from '@piggercode/protocol/spawnSession';
import { isPermissionMode, type PermissionMode } from '../../permissions/permissionTypes';

import { readNonBlankSessionControlIdentifier } from '@/sync/domains/sessionControl/opaqueIdentifiers';
import type { TerminalSpawnOptions } from '@/sync/domains/settings/terminalSettings';

export type ResumeHappySessionRpcParams = {
    type: 'resume-session';
    sessionId: string;
    directory: string;
    backendTarget: BackendTargetRefV1;
    resume?: string;
    environmentVariables?: Record<string, string>;
    terminal?: TerminalSpawnOptions;
    connectedServices?: SessionAuthoringValueV1['connectedServices'];
    connectedServicesUpdatedAt?: number;
    transcriptStorage?: 'direct' | 'persisted';
    attachMetadataIdentityPolicy?: SessionAttachMetadataIdentityPolicy;
    permissionMode?: PermissionMode;
    permissionModeUpdatedAt?: number;
    agentModeId?: string;
    agentModeUpdatedAt?: number;
    modelId?: string;
    modelUpdatedAt?: number;
    accountSettingsVersionHint?: number;
    initialTranscriptAfterSeq?: number;
    executionAuthorization?: import('@piggercode/protocol').SpawnSessionExecutionAuthorization;
    initialGoal?: SessionInitialGoalRequestV1;
    /** Every session runs as its CLI in a terminal: no chat backend goes with it. */
    nativeTerminal: true;
};

type BuildResumeHappySessionRpcInput = Omit<ResumeHappySessionRpcParams, 'type' | 'nativeTerminal'>;

const ResumeHappySessionRpcParamsSchema = z.object({
    type: z.literal('resume-session'),
    sessionId: z.string().min(1),
    directory: z.string().min(1),
    backendTarget: BackendTargetRefSchema,
    resume: z.string().min(1).optional(),
    environmentVariables: z.record(z.string(), z.string()).optional(),
    terminal: SpawnSessionTerminalSchema.optional(),
    connectedServices: SessionAuthoringValueV1Schema.shape.connectedServices.optional(),
    connectedServicesUpdatedAt: z.number().optional(),
    transcriptStorage: z.enum(['direct', 'persisted']).optional(),
    attachMetadataIdentityPolicy: SessionAttachMetadataIdentityPolicySchema.optional(),
    permissionMode: z.string().refine((value) => isPermissionMode(value)).optional(),
    permissionModeUpdatedAt: z.number().optional(),
    agentModeId: z.string().min(1).optional(),
    agentModeUpdatedAt: z.number().optional(),
    modelId: z.string().min(1).optional(),
    modelUpdatedAt: z.number().optional(),
    accountSettingsVersionHint: z.number().int().min(0).optional(),
    initialTranscriptAfterSeq: z.number().int().min(0).optional(),
    executionAuthorization: SpawnSessionExecutionAuthorizationSchema.optional(),
    initialGoal: SessionInitialGoalRequestV1Schema.optional(),
    nativeTerminal: z.literal(true),
});

export function buildResumeHappySessionRpcParams(input: BuildResumeHappySessionRpcInput): ResumeHappySessionRpcParams {
    const {
        modelId,
        modelUpdatedAt,
        connectedServices,
        connectedServicesUpdatedAt,
        ...rest
    } = input;
    const normalizedModelId = readNonBlankSessionControlIdentifier(modelId) ?? '';
    const includeModelOverride =
        normalizedModelId.length > 0 &&
        normalizedModelId !== 'default' &&
        typeof modelUpdatedAt === 'number' &&
        Number.isFinite(modelUpdatedAt);

    const params: ResumeHappySessionRpcParams = {
        type: 'resume-session',
        ...rest,
        nativeTerminal: true,
        ...(connectedServices === undefined || connectedServices === null ? {} : { connectedServices }),
        ...(connectedServices === undefined || connectedServices === null ? {} : (
            typeof connectedServicesUpdatedAt === 'number' && Number.isFinite(connectedServicesUpdatedAt)
                ? { connectedServicesUpdatedAt }
                : {}
        )),
        ...(includeModelOverride ? { modelId: normalizedModelId, modelUpdatedAt } : {}),
    };
    // Validate shape early to avoid accidentally sending secrets in wrong fields.
    ResumeHappySessionRpcParamsSchema.parse(params);
    return params;
}
