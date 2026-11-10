import { describe, expect, it } from 'vitest';

import { buildSpawnHappySessionRpcParams } from './spawnSessionPayload';

describe('buildSpawnHappySessionRpcParams', () => {
    it('asks the daemon to start every session as its CLI in a terminal', () => {
        expect(buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        } as any)).toEqual(expect.objectContaining({ nativeTerminal: true }));
    });

    it('preserves exact nonblank opaque model identifiers', () => {
        expect(buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            modelId: ' model-a ',
            modelUpdatedAt: 123,
        } as any)).toEqual(expect.objectContaining({ modelId: ' model-a ', modelUpdatedAt: 123 }));
    });

    it('preserves exact nonblank opaque agent mode identifiers', () => {
        expect(buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            agentModeId: ' plan\t',
            agentModeUpdatedAt: 123,
        } as any)).toEqual(expect.objectContaining({ agentModeId: ' plan\t', agentModeUpdatedAt: 123 }));
    });

    it('prefers codexBackendMode over legacy experimentalCodexAcp when provided together', () => {
        const params = buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            codexBackendMode: 'appServer',
            experimentalCodexAcp: true,
        } as any);

        expect(params).toEqual(expect.objectContaining({
            type: 'spawn-in-directory',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            codexBackendMode: 'appServer',
        }));
        expect(params).not.toHaveProperty('experimentalCodexAcp');
    });

    it('normalizes legacy experimentalCodexAcp onto canonical codexBackendMode when codexBackendMode is absent', () => {
        expect(buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            experimentalCodexAcp: true,
        } as any)).toEqual(expect.objectContaining({
            type: 'spawn-in-directory',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            codexBackendMode: 'acp',
            agentRuntimeDescriptorV1: expect.objectContaining({
                v: 1,
                providerId: 'codex',
                provider: expect.objectContaining({
                    backendMode: 'acp',
                }),
            }),
        }));
    });

    it('prefers agentRuntimeDescriptorV1 over legacy experimentalCodexAcp when codexBackendMode is absent', () => {
        const params = buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            experimentalCodexAcp: true,
            agentRuntimeDescriptorV1: {
                v: 1,
                providerId: 'codex',
                provider: {
                    backendMode: 'appServer',
                    vendorSessionId: 'codex-session-2',
                },
            },
        } as any);

        expect(params).toEqual(expect.objectContaining({
            type: 'spawn-in-directory',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            codexBackendMode: 'appServer',
            agentRuntimeDescriptorV1: {
                v: 1,
                providerId: 'codex',
                provider: {
                    backendMode: 'appServer',
                    vendorSessionId: 'codex-session-2',
                },
            },
        }));
        expect(params).not.toHaveProperty('experimentalCodexAcp');
    });

    it('derives agentRuntimeDescriptorV1 for codex spawn requests when codexBackendMode is set', () => {
        expect(buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            resume: 'codex-session-1',
            codexBackendMode: 'appServer',
        } as any)).toEqual(expect.objectContaining({
            type: 'spawn-in-directory',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            codexBackendMode: 'appServer',
            agentRuntimeDescriptorV1: expect.objectContaining({
                v: 1,
                providerId: 'codex',
                provider: expect.objectContaining({
                    backendMode: 'appServer',
                    vendorSessionId: 'codex-session-1',
                }),
            }),
        }));
    });

    it('omits legacy spawn token passthrough when present on a compatibility-shaped input', () => {
        const params = buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            token: 'legacy-spawn-token',
        } as any);

        expect(params).not.toHaveProperty('token');
    });

    it('includes the account settings version hint in daemon spawn requests', () => {
        const params = buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            accountSettingsVersionHint: 12,
        } as any);

        expect(params).toEqual(expect.objectContaining({
            accountSettingsVersionHint: 12,
        }));
    });

    it('carries first-input authority on the daemon spawn wire', () => {
        const compatibilityInput = {
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            pendingFirstInput: {
                text: '  preserve this exact prompt  ',
                localId: 'first-turn-123',
                meta: { profileId: 'profile-1' },
            },
            spawnNonce: ' spawn-nonce-opaque ',
        } as unknown as Parameters<typeof buildSpawnHappySessionRpcParams>[0];
        const params = buildSpawnHappySessionRpcParams(compatibilityInput);

        expect(params).toEqual(expect.objectContaining({
            spawnNonce: ' spawn-nonce-opaque ',
            pendingFirstInput: {
                text: '  preserve this exact prompt  ',
                localId: 'first-turn-123',
                meta: { profileId: 'profile-1' },
            },
        }));
    });

    it('forwards the typed source recipe to the daemon spawn payload', () => {
        const sourceContext = {
            v: 1,
            kind: 'session_replay',
            sourceSessionId: 'sess_source',
            forkPoint: { type: 'seq', upToSeqInclusive: 42 },
        } as const;

        const params = buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            sourceContext,
        } as any);

        expect(params.sourceContext).toEqual(sourceContext);
    });

    it('omits the source recipe only when the caller authored none', () => {
        const params = buildSpawnHappySessionRpcParams({
            machineId: 'machine-1',
            directory: '/tmp/workspace',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        } as any);

        expect(params).not.toHaveProperty('sourceContext');
    });

});
