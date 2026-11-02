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
// Agent marks are SVG/image leaves the test renderer cannot draw.
vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

type CapturedMenu = Readonly<{
    open: boolean;
    items: ReadonlyArray<{ id: string; rightElement?: unknown }>;
    selectedId?: string | null;
    onSelect: (id: string) => void;
}>;
const menuState = vi.hoisted(() => ({ current: null as CapturedMenu | null }));

// The popover portal is not rendered by the test renderer; the menu's items and selection are the contract.
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: CapturedMenu & {
        onOpenChange: (open: boolean) => void;
        trigger: (args: { open: boolean; toggle: () => void }) => React.ReactNode;
    }) => {
        menuState.current = props;
        return React.createElement('DropdownMenu', null, props.trigger({ open: props.open, toggle: () => props.onOpenChange(!props.open) }));
    },
}));

afterEach(() => {
    menuState.current = null;
    standardCleanup();
});

describe('SessionListAgentPicker', () => {
    it('shows the picked agent, lists the offered agents with their session counts and switches on select', async () => {
        const { SessionListAgentPicker } = await import('./SessionListAgentPicker');
        const onSelect = vi.fn();
        const onOpen = vi.fn();
        const onBrowse = vi.fn();
        const screen = await renderScreen(
            <SessionListAgentPicker
                options={['claude', 'codex']}
                selected="codex"
                counts={new Map([['codex', 2]])}
                onSelect={onSelect}
                onOpen={onOpen}
                onBrowse={onBrowse}
            />,
        );

        expect(screen.findByTestId('session-list-agent-picker')).not.toBeNull();
        expect(menuState.current?.selectedId).toBe('codex');
        expect(menuState.current?.items.map((item) => item.id)).toEqual(['claude', 'codex']);
        expect(menuState.current?.items.find((item) => item.id === 'claude')?.rightElement).toBeFalsy();
        expect(menuState.current?.items.find((item) => item.id === 'codex')?.rightElement).toBeTruthy();

        await screen.pressByTestIdAsync('session-list-agent-picker');
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(menuState.current?.open).toBe(true);

        menuState.current!.onSelect('claude');
        expect(onSelect).toHaveBeenCalledWith('claude');

        await screen.pressByTestIdAsync('session-list-browse-provider-sessions');
        expect(onBrowse).toHaveBeenCalledTimes(1);
    });
});
