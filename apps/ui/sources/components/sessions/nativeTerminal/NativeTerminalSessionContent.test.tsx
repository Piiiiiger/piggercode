import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
// The attached pane draws xterm and opens a PTY on the machine; this view only decides whether to mount it.
vi.mock('@/components/terminal/embedded/EmbeddedTerminalPane', () => ({
    EmbeddedTerminalPane: (props: Record<string, unknown>) => React.createElement('EmbeddedTerminalPane', props),
}));
vi.mock('@/components/terminal/embedded/EmbeddedTerminalToolbarIconButton', () => ({
    EmbeddedTerminalToolbarIconButton: (props: Record<string, unknown>) => React.createElement('EmbeddedTerminalToolbarIconButton', props),
}));
vi.mock('@/components/sessions/terminal/useSessionEmbeddedTerminalPty', () => ({
    useSessionEmbeddedTerminalPty: () => ({ status: 'connecting' }),
}));
vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: (props: Record<string, unknown>) => React.createElement('RoundButton', props),
}));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({
    ActivitySpinner: (props: Record<string, unknown>) => React.createElement('ActivitySpinner', props),
}));
vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: { children?: React.ReactNode }) => React.createElement('Text', props, props.children),
}));

describe('NativeTerminalSessionContent', () => {
    const originalState = storage.getState();
    afterEach(() => {
        storage.setState(originalState, true);
    });

    async function renderSession(session: ReturnType<typeof createSessionFixture>) {
        storage.setState({ sessions: { [session.id]: session } });
        const { NativeTerminalSessionContent } = await import('./NativeTerminalSessionContent');
        return renderScreen(<NativeTerminalSessionContent sessionId={session.id} serverId={null} />);
    }

    it('offers to move a chat that still runs into the terminal instead of attaching to it', async () => {
        const chat = createSessionFixture({ active: true });
        expect(chat.metadata?.nativeTerminal).not.toBe(true);

        const screen = await renderSession(chat);

        expect(screen.tree.root.findAllByType('EmbeddedTerminalPane' as never)).toHaveLength(0);
        expect(screen.findByTestId('session-native-terminal-chat-running')).not.toBeNull();
        expect(screen.findByTestId('session-native-terminal-switch')).not.toBeNull();
    });

    it('attaches to the CLI of a running terminal session', async () => {
        const base = createSessionFixture({ active: true });
        const screen = await renderSession({ ...base, metadata: { ...base.metadata!, nativeTerminal: true } });

        expect(screen.tree.root.findAllByType('EmbeddedTerminalPane' as never)).toHaveLength(1);
        expect(screen.findByTestId('session-native-terminal-chat-running')).toBeNull();
    });
});
