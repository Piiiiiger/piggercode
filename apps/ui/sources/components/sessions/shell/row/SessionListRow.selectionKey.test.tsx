import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';

import { installSessionShellCommonModuleMocks } from '../sessionShellTestHelpers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installSessionShellCommonModuleMocks();

const itemProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('react-native-reanimated', () => ({
    default: { View: 'Animated.View' },
}));
vi.mock('react-native-gesture-handler', () => ({
    GestureDetector: (props: { children: React.ReactNode }) => React.createElement('GestureDetector', null, props.children),
}));
// The row's drag machinery is a gesture boundary; the row under test only routes props.
vi.mock('../useSessionInlineDrag', () => ({
    useSessionInlineDrag: () => ({ gesture: {}, animatedStyle: {} }),
}));
vi.mock('../SessionItem', () => ({
    SessionItem: (props: Record<string, unknown>) => {
        itemProps.push(props);
        return React.createElement('SessionItem');
    },
}));

afterEach(() => {
    standardCleanup();
    itemProps.length = 0;
});

async function renderRow(extra: Readonly<{ selectionKey?: string }> = {}) {
    const { SessionListRow } = await import('./SessionListRow');
    const session = createSessionFixture({ id: 'sess_a', active: true, metadata: null });
    await renderScreen(
        <SessionListRow
            session={session}
            rowModel={{} as never}
            sessionKey="server_a:sess_a"
            treeRowId="session:server_a:sess_a"
            groupKey="recent"
            onDragStart={vi.fn()}
            resolveDropResult={vi.fn() as never}
            onDropResult={vi.fn()}
            onDragCancel={vi.fn()}
            isDragActive={false}
            isBeingDragged={false}
            dragEnabled={false}
            dataIndex={0}
            overlayShared={{} as never}
            onRegisterTreeRowBounds={vi.fn()}
            onUnregisterTreeRowBounds={vi.fn()}
            {...extra}
        />,
    );
    return itemProps.at(-1);
}

describe('SessionListRow selection key', () => {
    it('selects a list row by its session key, and keeps a row that opts out (the 「最近」 box) out of selections', async () => {
        expect((await renderRow())?.selectionKey).toBe('server_a:sess_a');
        expect((await renderRow({ selectionKey: '' }))?.selectionKey).toBe('');
    });
});
