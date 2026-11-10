import { describe, expect, test } from 'vitest';

import { buildResumeHappySessionRpcParams } from './resumeSessionPayload';

describe('buildResumeHappySessionRpcParams', () => {
    test('preserves exact nonblank opaque model identifiers', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            modelId: ' model-a ',
            modelUpdatedAt: 123,
        })).toEqual(expect.objectContaining({ modelId: ' model-a ', modelUpdatedAt: 123 }));
    });

    test('builds typed params for resume-session', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelId: 'claude-sonnet-4-5',
            modelUpdatedAt: 123,
        })).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelId: 'claude-sonnet-4-5',
            modelUpdatedAt: 123,
        });
    });

    test('omits model override when pair is incomplete', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelUpdatedAt: 123,
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        });

        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelId: 'claude-sonnet-4-5',
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        });
    });

    test('omits sentinel default model override', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            modelId: 'default',
            modelUpdatedAt: 123,
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        });
    });

    test('includes environment variables when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            environmentVariables: {
                EXAMPLE_ENV_A: 'one',
                EXAMPLE_ENV_B: 'two',
            },
        })).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            environmentVariables: {
                EXAMPLE_ENV_A: 'one',
                EXAMPLE_ENV_B: 'two',
            },
        });
    });

    test('includes transcriptStorage when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            transcriptStorage: 'direct',
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            transcriptStorage: 'direct',
        });
    });

    test('includes initial transcript catch-up cursor when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialTranscriptAfterSeq: 36,
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialTranscriptAfterSeq: 36,
        });
    });

    test('includes agent mode runtime controls when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            agentModeId: 'plan',
            agentModeUpdatedAt: 250,
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            agentModeId: 'plan',
            agentModeUpdatedAt: 250,
        });
    });

    test('includes initial goal controls when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialGoal: {
                objective: 'Line one\nLine two',
            },
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialGoal: {
                objective: 'Line one\nLine two',
            },
        });
    });

    test('includes connectedServices and freshness when provided', () => {
        const connectedServices = {
            v: 1,
            bindingsByServiceId: {
                anthropic: {
                    source: 'connected',
                    profileId: 'profile-1',
                },
            },
        };
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            connectedServices,
            connectedServicesUpdatedAt: 1234,
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            connectedServices,
            connectedServicesUpdatedAt: 1234,
        });
    });

    test('includes attachMetadataIdentityPolicy when provided', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            attachMetadataIdentityPolicy: 'replace_with_runtime_identity',
        } as any)).toEqual({
            type: 'resume-session',
            nativeTerminal: true,
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            attachMetadataIdentityPolicy: 'replace_with_runtime_identity',
        });
    });

    test('carries fresh user-request execution authorization through the resume RPC payload', () => {
        expect(buildResumeHappySessionRpcParams({
            sessionId: 's1',
            directory: '/tmp',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            initialTranscriptAfterSeq: 41,
            executionAuthorization: { provenance: 'user_request', requestId: ' message-1 ' },
        })).toMatchObject({
            type: 'resume-session',
            nativeTerminal: true,
            initialTranscriptAfterSeq: 41,
            executionAuthorization: { provenance: 'user_request', requestId: ' message-1 ' },
        });
    });
});
