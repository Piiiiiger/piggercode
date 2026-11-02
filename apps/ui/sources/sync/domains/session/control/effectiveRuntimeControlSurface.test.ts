import { describe, expect, it } from 'vitest';

import {
    resolveEffectiveConfiguredRuntimeControlSurface,
    resolveEffectiveSessionRuntimeControlSurface,
    supportsEffectiveLocalControlForSession,
} from './effectiveRuntimeControlSurface';

describe('effectiveRuntimeControlSurface', () => {
    it('uses the persisted Codex runtime kind to disable local control for MCP sessions', () => {
        expect(supportsEffectiveLocalControlForSession({
            agentId: 'codex',
            metadata: {
                codexBackendMode: 'mcp',
                runtime: { provider: 'codex', backendMode: 'mcp' },
            },
        })).toBe(false);
    });

    it('uses the shared Codex runtime default when no explicit backend mode is configured', () => {
        expect(resolveEffectiveConfiguredRuntimeControlSurface({
            agentId: 'codex',
            accountSettings: null,
        })).toMatchObject({
            sessionCapabilities: {
                sessionFork: { conversation: 'supported' },
            },
            localControl: { supported: true, topology: 'shared', attachStrategy: 'provider_attach' },
        });
    });
});
