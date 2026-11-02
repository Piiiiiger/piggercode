import { describe, expect, it } from 'vitest';
import { buildBackendTargetKey } from '@piggercode/protocol';

import { readAccountTranscriptStorageDefaults, resolveNewSessionDefaultTranscriptStorage } from './transcriptStorageDefaults';

describe('resolveNewSessionDefaultTranscriptStorage', () => {
    it('prefers backend target profile defaults over account defaults', () => {
        const target = { kind: 'builtInAgent', agentId: 'codex' } as const;
        const accountDefaults = readAccountTranscriptStorageDefaults({
            globalDefault: 'persisted',
            byTargetKey: {
                [buildBackendTargetKey(target)]: 'persisted',
            },
            enabledBackendTargets: [target],
        });

        expect(resolveNewSessionDefaultTranscriptStorage({
            agentType: 'codex',
            backendTarget: target,
            accountDefaults,
            profileDefaultsByTargetKey: {
                [buildBackendTargetKey(target)]: 'direct',
            },
        })).toBe('direct');
    });

    it('uses target-keyed account defaults for a backend target', () => {
        const target = { kind: 'builtInAgent', agentId: 'codex' } as const;
        const accountDefaults = readAccountTranscriptStorageDefaults({
            globalDefault: 'persisted',
            byTargetKey: {
                [buildBackendTargetKey(target)]: 'direct',
            },
            enabledBackendTargets: [target],
        });

        expect(resolveNewSessionDefaultTranscriptStorage({
            agentType: 'codex',
            backendTarget: target,
            accountDefaults,
        })).toBe('direct');
    });
});
