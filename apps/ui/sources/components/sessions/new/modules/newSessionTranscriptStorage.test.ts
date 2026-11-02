import { describe, expect, it } from 'vitest';

import {
    coerceNewSessionTranscriptStorage,
    supportsDirectTranscriptStorageForNewSession,
} from './newSessionTranscriptStorage';

describe('supportsDirectTranscriptStorageForNewSession', () => {
    it('uses shared agent session-storage support when no UI override is required', () => {
        expect(supportsDirectTranscriptStorageForNewSession({
            agentId: 'claude',
            settings: {},
        })).toBe(true);
    });
});

describe('coerceNewSessionTranscriptStorage', () => {
    it('keeps persisted storage when direct was not requested', () => {
        expect(coerceNewSessionTranscriptStorage({
            requested: 'persisted',
            agentId: 'claude',
            settings: {},
            directSessionsEnabled: true,
        })).toBe('persisted');
    });

    it('falls back to persisted when direct sessions are disabled', () => {
        expect(coerceNewSessionTranscriptStorage({
            requested: 'direct',
            agentId: 'claude',
            settings: {},
            directSessionsEnabled: false,
        })).toBe('persisted');
    });
});
