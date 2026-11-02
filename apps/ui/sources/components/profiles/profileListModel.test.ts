import { describe, expect, it, vi } from 'vitest';
import type { ProfileCompatibilitySummary } from '@/sync/domains/profiles/profileCompatibility';
import { getProfileBackendSubtitle, getProfileSubtitle, type ProfileListStrings } from '@/components/profiles/profileListModel';
import type { AgentId } from '@/agents/catalog/catalog';
import { installProfilesCommonModuleMocks } from './profilesTestHelpers';

installProfilesCommonModuleMocks();

describe('profileListModel', () => {
    const strings: ProfileListStrings = {
        builtInLabel: 'Built-in',
        customLabel: 'Custom',
        agentLabelById: {
            claude: 'Claude',
            codex: 'Codex',
        } as Record<AgentId, string>,
    };

    function buildProfile(params: {
        isBuiltIn?: boolean;
        compatibility?: Record<string, boolean>;
        compatibilityByTargetKey?: Record<string, boolean>;
    }): ProfileCompatibilitySummary {
        return {
            isBuiltIn: params.isBuiltIn ?? false,
            compatibility: params.compatibility ?? {},
            compatibilityByTargetKey: params.compatibilityByTargetKey,
        };
    }

    it('builds backend subtitle for enabled compatible agents', () => {
        const profile = buildProfile({
            compatibility: { claude: true, codex: true },
        });
        expect(getProfileBackendSubtitle({ profile, enabledAgentIds: ['claude', 'codex'], strings })).toBe('Claude • Codex');
    });

    it('skips disabled agents even if compatible', () => {
        const profile = buildProfile({
            compatibility: { claude: true, codex: true },
        });
        expect(getProfileBackendSubtitle({ profile, enabledAgentIds: ['codex'], strings })).toBe('Codex');
    });

    it('returns empty backend subtitle when no enabled compatible agents exist', () => {
        const profile = buildProfile({
            compatibility: { claude: false, codex: false },
        });
        expect(getProfileBackendSubtitle({ profile, enabledAgentIds: ['claude', 'codex'], strings })).toBe('');
    });

    it('ignores compatible agents when display labels are missing', () => {
        const profile = buildProfile({
            compatibility: { codex: true },
        });
        const stringsWithMissingCodex = {
            ...strings,
            agentLabelById: { ...strings.agentLabelById, codex: '' },
        };
        expect(getProfileBackendSubtitle({ profile, enabledAgentIds: ['codex'], strings: stringsWithMissingCodex })).toBe('');
    });

    it('builds built-in subtitle with backend', () => {
        const profile = buildProfile({
            isBuiltIn: true,
            compatibility: { claude: true, codex: false },
        });
        expect(getProfileSubtitle({ profile, enabledAgentIds: ['claude', 'codex'], strings })).toBe('Built-in · Claude');
    });

    it('builds custom subtitle without backend', () => {
        const profile = buildProfile({
            compatibility: { claude: false, codex: false },
        });
        expect(getProfileSubtitle({ profile, enabledAgentIds: ['claude', 'codex'], strings })).toBe('Custom');
    });
});
