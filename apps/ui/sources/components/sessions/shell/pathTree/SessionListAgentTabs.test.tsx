import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('@/text', async () => {
    const { installTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return installTextModuleMock({ translate: (key: string) => key })();
});
vi.mock('react-native-unistyles', async () => {
    const { installUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return installUnistylesMock()();
});
vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: React.Attributes & Record<string, unknown>) => React.createElement('Ionicons', props),
}));

afterEach(() => {
    standardCleanup();
});

describe('SessionListAgentTabs', () => {
    it('offers All plus each agent that has sessions and reports the picked agent', async () => {
        const { SessionListAgentTabs } = await import('./SessionListAgentTabs');
        const onSelectAgent = vi.fn();
        const screen = await renderScreen(
            <SessionListAgentTabs
                counts={new Map([['codex', 2], ['claude', 1]])}
                selectedAgentId={null}
                onSelectAgent={onSelectAgent}
                onBrowse={null}
            />,
        );

        expect(screen.findByTestId('session-list-agent-tabs:all')).not.toBeNull();
        expect(screen.findByTestId('session-list-agent-tabs:codex')).not.toBeNull();
        expect(screen.findByTestId('session-list-agent-tabs:claude')).not.toBeNull();
        expect(screen.findByTestId('session-list-agent-tabs:gemini')).toBeNull();

        await screen.pressByTestIdAsync('session-list-agent-tabs:claude');
        expect(onSelectAgent).toHaveBeenLastCalledWith('claude');
        await screen.pressByTestIdAsync('session-list-agent-tabs:all');
        expect(onSelectAgent).toHaveBeenLastCalledWith(null);
    });

    it('shows All selected when the remembered agent has no sessions left', async () => {
        const { SessionListAgentTabs } = await import('./SessionListAgentTabs');
        const screen = await renderScreen(
            <SessionListAgentTabs
                counts={new Map([['codex', 2]])}
                selectedAgentId="claude"
                onSelectAgent={vi.fn()}
                onBrowse={vi.fn()}
            />,
        );

        expect(screen.findByTestId('session-list-agent-tabs:all')?.props.accessibilityState).toEqual({ selected: true });
        expect(screen.findByTestId('session-list-browse-provider-sessions')).not.toBeNull();
    });
});
