import { describe, expect, test } from 'vitest';

import { canAgentResume, canContinueSessionWithFreshSpawn, canResumeSession, canResumeSessionWithOptions, getAgentVendorResumeId } from './resumeCapabilities';

describe('getAgentVendorResumeId', () => {
    test('returns null when metadata missing', () => {
        expect(getAgentVendorResumeId(null, 'claude')).toBeNull();
    });

    test('returns Claude session id when agent is claude', () => {
        expect(getAgentVendorResumeId({ claudeSessionId: 'c1' }, 'claude')).toBe('c1');
    });

    test('returns null for Codex vendor resume when disabled by settings', () => {
        expect(getAgentVendorResumeId(
            { codexSessionId: 'x1' },
            'codex',
            { accountSettings: { codexBackendMode: 'mcp' } },
        )).toBeNull();
    });

    test('returns Codex session id when experimental resume is enabled for Codex by settings', () => {
        expect(getAgentVendorResumeId(
            { codexSessionId: 'x1' },
            'codex',
            { accountSettings: { codexBackendMode: 'acp' } },
        )).toBe('x1');
    });

    test('returns Codex session id when appServer resume is enabled for Codex by settings', () => {
        expect(getAgentVendorResumeId(
            { codexSessionId: 'x1' },
            'codex',
            { accountSettings: { codexBackendMode: 'appServer' } },
        )).toBe('x1');
    });

    test('treats persisted Codex flavor aliases as Codex for resume', () => {
        expect(getAgentVendorResumeId(
            { codexSessionId: 'x1' },
            'openai',
            { accountSettings: { codexBackendMode: 'acp' } },
        )).toBe('x1');
        expect(getAgentVendorResumeId(
            { codexSessionId: 'x1' },
            'gpt',
            { accountSettings: { codexBackendMode: 'acp' } },
        )).toBe('x1');
    });

    test('treats empty ids as missing and trims non-empty strings', () => {
        expect(getAgentVendorResumeId({ claudeSessionId: '' }, 'claude')).toBeNull();
        expect(getAgentVendorResumeId({ claudeSessionId: ' c1 ' }, 'claude')).toBe('c1');
        expect(getAgentVendorResumeId(
            { codexSessionId: '   ' },
            'codex',
            { accountSettings: { codexBackendMode: 'acp' } },
        )).toBeNull();
    });

    test('returns null when metadata does not contain the canonical field for the resolved agent', () => {
        expect(getAgentVendorResumeId({ sessionId: 'x1' }, 'claude')).toBeNull();
        expect(getAgentVendorResumeId(
            { sessionId: 'x1' },
            'codex',
            { accountSettings: { codexBackendMode: 'acp' } },
        )).toBeNull();
    });

    test('supports persisted alias flavors for codex in table-driven form', () => {
        const aliases = ['codex', 'openai', 'gpt'] as const;
        for (const alias of aliases) {
            expect(
                getAgentVendorResumeId(
                    { codexSessionId: 'x1' },
                    alias,
                    { accountSettings: { codexBackendMode: 'acp' } },
                ),
            ).toBe('x1');
        }
    });
});

describe('canContinueSessionWithFreshSpawn', () => {
    test('continuable when the agent supports vendor resume but no vendor id was ever persisted (pre-SessionStart death, QA A-F5)', () => {
        expect(canContinueSessionWithFreshSpawn({ flavor: 'claude' })).toBe(true);
    });

    test('not the fresh-spawn case once a vendor resume id exists', () => {
        expect(canContinueSessionWithFreshSpawn({ flavor: 'claude', claudeSessionId: 'c1' })).toBe(false);
    });

    test('not continuable for unknown flavors', () => {
        expect(canContinueSessionWithFreshSpawn({ flavor: 'mystery-agent' })).toBe(false);
        expect(canContinueSessionWithFreshSpawn(null)).toBe(false);
    });

    test('continuable even when experimental vendor resume is disabled by settings (fresh spawn needs no resume support)', () => {
        expect(canContinueSessionWithFreshSpawn(
            { flavor: 'codex' },
            { accountSettings: { codexBackendMode: 'mcp' } },
        )).toBe(true);
    });

});
