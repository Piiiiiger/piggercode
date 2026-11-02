import { describe, expect, it } from 'vitest';
import { buildBackendTargetKey } from '@piggercode/protocol';
import type { PermissionMode } from './permissionTypes';
import { readAccountPermissionDefaults, resolveNewSessionDefaultPermissionMode } from './permissionDefaults';

describe('resolveNewSessionDefaultPermissionMode', () => {
    const accountDefaultsByTargetKey = {
        [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: 'plan' as PermissionMode,
        [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: 'safe-yolo' as PermissionMode,
    };
    const accountDefaults = readAccountPermissionDefaults(accountDefaultsByTargetKey, ['claude', 'codex']);

    it('reads account defaults from backend target keys', () => {
        expect(readAccountPermissionDefaults(accountDefaultsByTargetKey, ['claude', 'codex'])).toEqual({
            byTargetKey: {
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: 'plan',
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: 'safe-yolo',
            },
        });
    });

    it('uses account defaults when no profile override is present', () => {
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'claude', accountDefaults })).toBe('read-only');
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'codex', accountDefaults })).toBe('safe-yolo');
    });

    it('uses canonical target-keyed profile overrides when present', () => {
        const profileDefaultsByTargetKey = {
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: 'yolo' as PermissionMode,
        };
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'codex', accountDefaults, profileDefaultsByTargetKey })).toBe('yolo');
        // Other providers fall back to account defaults when no override exists.
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'claude', accountDefaults, profileDefaultsByTargetKey })).toBe('read-only');
    });

    it('falls back to legacy profile override mapping when provider-specific override is missing', () => {
        const emptyAccountDefaults = readAccountPermissionDefaults({}, ['claude', 'codex']);
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'claude', accountDefaults: emptyAccountDefaults, legacyProfileDefaultPermissionMode: 'plan' })).toBe('read-only');
        // Legacy "plan" is mapped to read-only.
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'codex', accountDefaults: emptyAccountDefaults, legacyProfileDefaultPermissionMode: 'plan' })).toBe('read-only');
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'codex', accountDefaults: emptyAccountDefaults, legacyProfileDefaultPermissionMode: 'bypassPermissions' })).toBe('yolo');
    });

    it('clamps unsupported profile override modes to safe defaults for the target provider', () => {
        // Codex-like agents do not expose "plan" as a permission mode.
        const emptyAccountDefaults = readAccountPermissionDefaults({}, ['codex']);
        expect(resolveNewSessionDefaultPermissionMode({ agentType: 'codex', accountDefaults: emptyAccountDefaults, legacyProfileDefaultPermissionMode: 'plan' })).toBe('read-only');
    });
});
