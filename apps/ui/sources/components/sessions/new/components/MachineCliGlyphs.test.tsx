import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CapabilityDetectResult } from '@/sync/api/capabilities/capabilitiesProtocol';
import { renderScreen } from '@/dev/testkit';
import { installMachineComponentCommonModuleMocks } from '@/components/machines/machineComponentTestHelpers';
import { MachineCliGlyphs } from './MachineCliGlyphs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installMachineComponentCommonModuleMocks();

vi.mock('@/hooks/server/useDaemonScopedMachineCapabilitiesCache', () => ({
    useDaemonScopedMachineCapabilitiesCache: () => ({
        state: {
            status: 'loaded',
            snapshot: {
                response: {
                    protocolVersion: 1,
                    results: {
                        'cli.codex': {
                            ok: true,
                            checkedAt: 1,
                            data: { available: true },
                        } satisfies CapabilityDetectResult,
                    },
                },
            },
        },
    }),
}));

const detectionTarget = vi.hoisted(() => ({ current: { daemonStateVersion: 1, isOnline: true, agentsHosted: true } }));
vi.mock('@/sync/domains/state/storage', () => ({
    useMachineCliDetectionTarget: () => detectionTarget.current,
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({
    useEnabledAgentIds: () => ['codex'],
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['codex'],
    getAgentCore: () => ({
        cli: { detectKey: 'codex' },
        ui: {},
    }),
}));

vi.mock('@/agents/registry/registryUi', () => ({
    getAgentPickerIconScale: () => 1,
}));

// Stub the provider-logo component so the test does not depend on real SVG assets;
// it exposes the resolved agentId so we can assert the right logo is rendered.
vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: ({ agentId, testID }: { agentId: string; testID?: string }) =>
        React.createElement('AgentIcon', { testID: testID ?? `machine-cli-logo:${agentId}`, agentId }),
}));

describe('MachineCliGlyphs', () => {
    it('renders a provider logo for each detected CLI (canonical capability ids)', async () => {
        const tree = await renderScreen(React.createElement(MachineCliGlyphs, {
            machineId: 'machine-1',
            isOnline: true,
        }));

        const icons = tree.findAllByType('AgentIcon');
        expect(icons.some((node) => node.props.agentId === 'codex')).toBe(true);
    });

    it('shows no agents for a computer that does not run them, even when their CLIs were detected there', async () => {
        detectionTarget.current = { daemonStateVersion: 1, isOnline: true, agentsHosted: false };
        try {
            const tree = await renderScreen(React.createElement(MachineCliGlyphs, {
                machineId: 'machine-1',
                isOnline: true,
            }));

            expect(tree.findAllByType('AgentIcon')).toHaveLength(0);
        } finally {
            detectionTarget.current = { daemonStateVersion: 1, isOnline: true, agentsHosted: true };
        }
    });
});
