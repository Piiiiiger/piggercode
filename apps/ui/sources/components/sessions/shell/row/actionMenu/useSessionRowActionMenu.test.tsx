import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { SESSION_ACTION_DELETE_ID } from '@/components/sessions/actions/sessionActionIds';
import { Modal } from '@/modal';

import { useSessionRowActionMenu } from './useSessionRowActionMenu';

const opsState = vi.hoisted(() => ({
    deleteSession: vi.fn(async (_sessionId: string, _opts?: { serverId?: string | null }) => ({ success: true })),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ confirmResult: true }).module;
});

// The server request is the boundary; the action and its confirmation run for real.
vi.mock('@/sync/ops', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/ops')>()),
    sessionTrashWithServerScope: opsState.deleteSession,
}));

describe('useSessionRowActionMenu', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('dispatches contextual menu item selections through their owning handler', async () => {
        const session: SessionListRenderableSession = {
            id: 'session_1',
            active: false,
            archivedAt: null,
            owner: 'user_1',
            accessLevel: undefined,
            seq: 4,
            lastViewedSessionSeq: 4,
            latestTurnStatus: 'completed',
            createdAt: 1,
            updatedAt: 1,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: null,
            thinking: false,
            thinkingAt: 0,
            presence: 1,
        };
        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'user_1',
            isConnected: true,
            isPinned: false,
        });
        const onSelectLeadingMenuItem = vi.fn(async () => undefined);

        const hook = await renderHook(() => useSessionRowActionMenu({
            target,
            sessionName: 'Session 1',
            hideInactiveSessions: false,
            iconColor: '#999',
            activeTags: [],
            knownTags: [],
            tagsEnabled: false,
            leadingMenuItems: [
                { id: 'session.copyDebugInformation', title: 'Copy information' },
            ],
            onSelectLeadingMenuItem,
            selectionModeAvailable: false,
            selectionModeActive: false,
            isNativeMobile: false,
            setContextMenuOpen: vi.fn(),
            openTagsMenuFromContext: vi.fn(),
        }));

        expect(hook.getCurrent().moreMenuItems.some((item) => item.id === 'session.copyDebugInformation')).toBe(true);

        await act(async () => {
            await hook.getCurrent().handleMoreMenuSelect('session.copyDebugInformation');
        });

        expect(onSelectLeadingMenuItem).toHaveBeenCalledWith('session.copyDebugInformation');
    });

    it('deletes a stopped session from the row menu after a destructive confirmation, and keeps it when cancelled', async () => {
        const session: SessionListRenderableSession = {
            id: 'session_2', active: false, archivedAt: null, owner: 'user_1', accessLevel: undefined,
            seq: 4, lastViewedSessionSeq: 4, latestTurnStatus: 'completed', createdAt: 1, updatedAt: 1, activeAt: 1,
            metadataVersion: 1, agentStateVersion: 1, metadata: null, thinking: false, thinkingAt: 0, presence: 1,
        };
        const target = createSessionActionTarget({
            session,
            serverId: 'server_1',
            currentUserId: 'user_1',
            isConnected: false,
            isPinned: false,
        });
        const hook = await renderHook(() => useSessionRowActionMenu({
            target,
            sessionName: 'Session 2',
            hideInactiveSessions: false,
            iconColor: '#999',
            dangerIconColor: '#c00',
            activeTags: [],
            knownTags: [],
            tagsEnabled: false,
            selectionModeAvailable: false,
            selectionModeActive: false,
            isNativeMobile: false,
            setContextMenuOpen: vi.fn(),
            openTagsMenuFromContext: vi.fn(),
        }));

        vi.mocked(Modal.confirm).mockResolvedValueOnce(false);
        await act(async () => {
            await hook.getCurrent().handleMoreMenuSelect(SESSION_ACTION_DELETE_ID);
        });
        expect(Modal.confirm).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.objectContaining({ destructive: true }),
        );
        expect(opsState.deleteSession).not.toHaveBeenCalled();

        await act(async () => {
            await hook.getCurrent().handleMoreMenuSelect(SESSION_ACTION_DELETE_ID);
        });
        await vi.waitFor(() => {
            expect(opsState.deleteSession).toHaveBeenCalledWith('session_2', expect.objectContaining({ serverId: 'server_1' }));
        });
    });
});

