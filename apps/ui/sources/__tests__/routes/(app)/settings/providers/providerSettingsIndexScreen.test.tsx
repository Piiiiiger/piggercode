import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Constants from 'expo-constants';
import { standardCleanup } from '@/dev/testkit';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from '../sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSettingsEntryModuleMocks({
    textModule: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    textSecondary: '#999',
                },
            },
        });
    },
    storageModule: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSetting: (key: string) => {
                    if (key === 'backendEnabledByTargetKey') return {};
                    return undefined;
                },
            },
        });
    },
});

vi.mock('@/components/settings/acpCatalog/AcpCatalogSettingsSections', () => ({
    AcpCatalogSettingsSections: () => React.createElement('AcpCatalogSettingsSections'),
}));

vi.mock('@/agents/catalog/catalog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/agents/catalog/catalog')>();
    return {
        ...actual,
        AGENT_IDS: ['codex', 'customAcp', 'kiro'],
        getAgentCore: (agentId: Parameters<typeof actual.getAgentCore>[0]) => {
            const core = actual.getAgentCore(agentId);
            return {
                ...core,
                displayNameKey: `agent.${agentId}`,
                availability: { ...core.availability, experimental: agentId === 'kiro' },
                ui: { ...core.ui, agentPickerIconName: 'code-slash-outline' },
            };
        },
    };
});

afterEach(() => {
    delete (Constants.expoConfig!.extra as Record<string, unknown>).app;
    resetSessionSettingsEntryState();
    standardCleanup();
});

describe('ProviderSettingsIndexScreen', () => {
    it('renders built-in providers without custom ACP and includes ACP backend sections', async () => {
        const Screen = (await import('@/app/(app)/settings/providers')).default;
        const screen = await renderSettingsView(React.createElement(Screen));

        expect(screen.findRowByTitle('agent.codex')).toBeTruthy();
        expect(screen.findRowByTitle('agent.kiro')).toBeTruthy();
        expect(screen.findRowByTitle('agent.customAcp')).toBeFalsy();

        const acpSections = screen.findAllByType('AcpCatalogSettingsSections' as any);
        expect(acpSections).toHaveLength(1);

        await act(async () => {
            screen.pressRowByTitle('agent.codex');
        });

        expect(sessionSettingsEntryState.routerPushSpy).toHaveBeenCalledWith('/settings/providers/codex');
    });

    it('lists only the agents the build offers, without the ACP sections when Custom ACP is not offered', async () => {
        (Constants.expoConfig!.extra as Record<string, unknown>).app = { agentIds: ['claude', 'codex'] };
        const Screen = (await import('@/app/(app)/settings/providers')).default;
        const screen = await renderSettingsView(React.createElement(Screen));

        expect(screen.findRowByTitle('agent.codex')).toBeTruthy();
        expect(screen.findRowByTitle('agent.kiro')).toBeFalsy();
        expect(screen.findAllByType('AcpCatalogSettingsSections' as any).length).toBe(0);
    });
});
