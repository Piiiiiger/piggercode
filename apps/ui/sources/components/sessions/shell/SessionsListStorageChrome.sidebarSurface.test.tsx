import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerState = vi.hoisted(() => ({
    push: vi.fn(),
}));

installSessionShellCommonModuleMocks({
    router: async () => ({
        useRouter: () => routerState,
    }),
    // The agent tabs render translated labels with parameters, which must stay strings.
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => key,
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, props.children),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

function findStorageTabs(screen: { root: { findAll: (predicate: (node: { props: Record<string, unknown> }) => boolean) => unknown[] } }) {
    return screen.root.findAll((node) => String(node.props.testID ?? '').startsWith('sessions-list-storage-tab:'));
}

describe('SessionsListStorageChrome sidebar surface', () => {
    it('renders only the direct browse action, without storage tabs, when direct sessions are enabled', async () => {
        const { SessionsListStorageChrome } = await import('./SessionsListStorageChrome');

        const screen = await renderScreen(<SessionsListStorageChrome directSessionsEnabled />);

        expect(findStorageTabs(screen)).toHaveLength(0);
        const itemGroups = screen.findAllByType('ItemGroup' as never);
        expect(itemGroups).toHaveLength(1);
        expect(itemGroups[0]?.props.constrainToContentWidth).toBe(false);

        const browseContainerStyle = flattenStyle(itemGroups[0]?.props.style);
        expect(browseContainerStyle.marginTop).toBe(-4);
        expect(browseContainerStyle.maxWidth).toBeUndefined();
        expect(browseContainerStyle.backgroundColor).toBeUndefined();

        const browseSurfaceStyle = flattenStyle(itemGroups[0]?.props.containerStyle);
        expect(browseSurfaceStyle.backgroundColor).toBe('transparent');
        expect(browseSurfaceStyle.boxShadow).toBe('none');
        expect(browseSurfaceStyle.shadowOpacity).toBe(0);
        expect(browseSurfaceStyle.elevation).toBe(0);
    });

    it('swaps the browse row for agent tabs with a browse button once the list has sessions', async () => {
        const { SessionsListStorageChrome } = await import('./SessionsListStorageChrome');
        const data = [
            { type: 'header', headerKind: 'sessions', title: 'Sessions', groupKey: 'sessions:s1', serverId: 's1' },
            { type: 'session', serverId: 's1', groupKey: 'g1', section: 'sessions', session: { id: 'a', metadata: { flavor: 'codex' } } },
        ] as unknown as SessionListViewItem[];

        const screen = await renderScreen(<SessionsListStorageChrome directSessionsEnabled data={data} />);

        expect(screen.findAllByType('ItemGroup' as never)).toHaveLength(0);
        expect(screen.findByTestId('session-list-agent-tabs:codex')).not.toBeNull();
        await screen.pressByTestIdAsync('session-list-browse-provider-sessions');
        expect(routerState.push).toHaveBeenCalledWith('/direct/browse');
    });

    it('renders no storage chrome when direct sessions are disabled', async () => {
        const { SessionsListStorageChrome } = await import('./SessionsListStorageChrome');

        const screen = await renderScreen(<SessionsListStorageChrome directSessionsEnabled={false} />);

        expect(findStorageTabs(screen)).toHaveLength(0);
        expect(screen.findAllByType('ItemGroup' as never)).toHaveLength(0);
    });
});
