import type { AgentCore, AgentId } from './types.js';
import { getProviderCliRuntimeSpec } from './providers/providerCliRuntime.js';

export const DEFAULT_AGENT_ID: AgentId = 'claude';

const NO_NATIVE_IMAGE_GENERATION = 'unsupported' as const;
const GENERIC_SESSION_MEDIA_OUTPUT = 'supported' as const;
const EXPERIMENTAL_SESSION_MEDIA_OUTPUT = 'experimental' as const;

function providerDetectKey(agentId: AgentId): string {
    return getProviderCliRuntimeSpec(agentId).binaryName;
}

export const AGENTS_CORE = {
    claude: {
        id: 'claude',
        cliSubcommand: 'claude',
        detectKey: providerDetectKey('claude'),
        flavorAliases: [],
        cloudConnect: { vendorKey: 'anthropic', status: 'wired' },
        connectedServices: {
            supportedServiceIds: ['claude-subscription', 'anthropic'],
            quotaResetServiceIds: ['claude-subscription'],
            sessionAuthSwitch: {
                continuityMode: 'restart_same_home',
                supportedTransitions: ['same_connected_group'],
                providerStateSharingRequired: {
                    serviceIds: ['claude-subscription', 'anthropic'],
                    supportedTransitions: ['native_to_connected', 'connected_to_native', 'connected_to_connected'],
                },
            },
            providerStateSharing: {
                config: {
                    supported: true,
                    modes: ['linked', 'copied', 'isolated'],
                },
                state: {
                    supported: true,
                    modes: ['isolated', 'shared'],
                    sharedStatePrivacyRiskAcknowledgementRequired: true,
                },
            },
            supportedKindsByServiceId: {
                'claude-subscription': ['oauth', 'token'],
                anthropic: ['token'],
            },
        },
        resume: {
            vendorResume: 'supported',
            vendorResumeIdField: 'claudeSessionId',
            // The Agent's own session-log POINTER for the handoff brief, not a
            // resume gate (`AM-24`). The predecessor key name is retained
            // deliberately — see `AgentResumeConfig`.
            vendorResumeContinuityProofField: 'claudeTranscriptPath',
        },
        sessionStorage: { direct: true, persisted: true },
        sessionCapabilities: {
            sessionListing: 'supported',
            sessionFork: { conversation: 'unsupported', fromMessage: 'unsupported' },
            sessionRollback: { conversation: 'unsupported' },
            usageLimitRecovery: { checkNow: 'supported' },
        },
        handoff: { vendorStateTransfer: 'supported', existingState: true },
        localControl: { supported: true, topology: 'exclusive', attachStrategy: 'tmux' },
        runtimeInput: {
            inFlightSteerSupported: true,
            terminalPromptInjectionSupported: true,
        },
        tools: { delivery: 'native_mcp', support: 'supported' },
        media: {
            acceptsImageInput: 'supported',
            emitsSessionMedia: GENERIC_SESSION_MEDIA_OUTPUT,
            nativeImageGeneration: NO_NATIVE_IMAGE_GENERATION,
        },
    },
    codex: {
        id: 'codex',
        cliSubcommand: 'codex',
        detectKey: providerDetectKey('codex'),
        flavorAliases: ['codex-acp', 'codex-mcp', 'openai', 'gpt'],
        cloudConnect: { vendorKey: 'openai', status: 'wired' },
        connectedServices: {
            supportedServiceIds: ['openai-codex', 'openai'],
            quotaResetServiceIds: ['openai-codex'],
            sessionAuthSwitch: {
                continuityMode: 'restart_shared_state_required',
                supportedTransitions: ['same_connected_group'],
                providerStateSharingRequired: {
                    serviceIds: ['openai-codex'],
                    supportedTransitions: ['native_to_connected', 'connected_to_native', 'connected_to_connected'],
                },
            },
            providerStateSharing: {
                config: {
                    supported: true,
                    modes: ['linked', 'copied', 'isolated'],
                },
                state: {
                    supported: true,
                    modes: ['isolated', 'shared'],
                    sharedStatePrivacyRiskAcknowledgementRequired: true,
                },
            },
            supportedKindsByServiceId: {
                'openai-codex': ['oauth'],
                openai: ['token'],
            },
        },
        resume: { vendorResume: 'experimental', vendorResumeIdField: 'codexSessionId' },
        sessionStorage: { direct: true, persisted: true },
        sessionCapabilities: {
            sessionListing: 'supported',
            sessionFork: { conversation: 'supported', fromMessage: 'unsupported' },
            sessionRollback: { conversation: 'supported' },
            usageLimitRecovery: { checkNow: 'supported' },
        },
        runtimeKinds: {
            defaultKind: 'appServer',
            byKind: {
                mcp: {
                    kind: 'mcp',
                    overrides: {
                        resume: { vendorResume: 'unsupported' },
                        sessionCapabilities: {
                            sessionFork: { conversation: 'unsupported' },
                            sessionRollback: { conversation: 'unsupported' },
                            usageLimitRecovery: { checkNow: 'unsupported' },
                        },
                        handoff: { vendorStateTransfer: 'unsupported' },
                        localControl: null,
                        media: { nativeImageGeneration: NO_NATIVE_IMAGE_GENERATION },
                    },
                },
                acp: {
                    kind: 'acp',
                    overrides: {
                        sessionCapabilities: {
                            sessionFork: { conversation: 'unsupported' },
                            sessionRollback: { conversation: 'unsupported' },
                            usageLimitRecovery: { checkNow: 'unsupported' },
                        },
                        localControl: { supported: true, topology: 'exclusive', attachStrategy: 'tmux' },
                        media: { nativeImageGeneration: NO_NATIVE_IMAGE_GENERATION },
                    },
                },
                appServer: {
                    kind: 'appServer',
                    overrides: {
                        localControl: { supported: true, topology: 'shared', attachStrategy: 'provider_attach' },
                    },
                },
            },
        },
        handoff: { vendorStateTransfer: 'experimental', requiresExplicitSessionId: true, existingState: true },
        localControl: { supported: true, topology: 'exclusive', attachStrategy: 'tmux' },
        tools: { delivery: 'native_mcp', support: 'supported' },
        media: {
            acceptsImageInput: 'supported',
            emitsSessionMedia: GENERIC_SESSION_MEDIA_OUTPUT,
            nativeImageGeneration: 'supported',
        },
    },
} as const satisfies Record<AgentId, AgentCore>;
