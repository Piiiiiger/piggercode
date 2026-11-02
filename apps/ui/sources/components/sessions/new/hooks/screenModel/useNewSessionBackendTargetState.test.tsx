import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedBackendCatalogEntry } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';

import { useNewSessionBackendTargetState } from './useNewSessionBackendTargetState';
import { renderScreen } from '@/dev/testkit';


const applySettingsMock = vi.fn();

vi.mock('@/sync/store/settingsWriters', () => ({
    useApplySettings: () => applySettingsMock,
}));

const entries: ReadonlyArray<ResolvedBackendCatalogEntry> = [
    {
        target: { kind: 'builtInAgent', agentId: 'claude' },
        targetKey: 'agent:claude',
        family: 'builtInAgent',
        providerAgentId: 'claude',
        builtInAgentId: 'claude',
        iconAgentId: 'claude',
        title: 'Claude',
        subtitle: 'claude',
    },
    {
        target: { kind: 'builtInAgent', agentId: 'codex' },
        targetKey: 'agent:codex',
        family: 'builtInAgent',
        providerAgentId: 'codex',
        builtInAgentId: 'codex',
        iconAgentId: 'codex',
        title: 'Codex',
        subtitle: 'codex',
    },
];

describe('useNewSessionBackendTargetState', () => {
    beforeEach(() => {
        applySettingsMock.mockReset();
    });

    it('restores the last used backend target', async () => {
        let observed: ReturnType<typeof useNewSessionBackendTargetState> | null = null;

        function Probe() {
            observed = useNewSessionBackendTargetState({
                entries,
                lastUsedAgent: 'codex',
                lastUsedBackendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            } as any);
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect((observed as ReturnType<typeof useNewSessionBackendTargetState> | null)?.backendTarget).toEqual({ kind: 'builtInAgent', agentId: 'codex' });
    });

    it('does not persist a mount-resolved target before the user selects one', async () => {
        function Probe() {
            useNewSessionBackendTargetState({
                entries,
                lastUsedAgent: 'claude',
                lastUsedBackendTarget: { kind: 'builtInAgent', agentId: 'claude' },
                routeBackendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            } as any);
            return null;
        }

        await renderScreen(React.createElement(Probe));

        // Opening the screen is not "using" a backend: the launch path persists the last-used
        // target when a session is actually created.
        expect(applySettingsMock).not.toHaveBeenCalled();
    });

    it('prefers an explicit route backend target over last-used defaults', async () => {
        let observed: ReturnType<typeof useNewSessionBackendTargetState> | null = null;

        function Probe() {
            observed = useNewSessionBackendTargetState({
                entries,
                lastUsedAgent: 'claude',
                lastUsedBackendTarget: { kind: 'builtInAgent', agentId: 'claude' },
                routeBackendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            } as any);
            return null;
        }

        await renderScreen(React.createElement(Probe));

        expect((observed as ReturnType<typeof useNewSessionBackendTargetState> | null)?.backendTarget).toEqual({
            kind: 'builtInAgent',
            agentId: 'codex',
        });
    });
});
