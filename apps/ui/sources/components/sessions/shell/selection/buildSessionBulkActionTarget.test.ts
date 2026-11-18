import { describe, expect, it } from 'vitest';

import { SESSION_BULK_ACTION_IDS } from '@/components/sessions/actions/sessionBulkActionTypes';
import { listSessionBulkActionDescriptors } from '@/components/sessions/actions/sessionBulkActionPresentation';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionAttentionStandingPolicy } from '@/sync/domains/session/organization/attentionStanding';

import type {
    SessionListRowPresentationSettings,
    SessionListSessionItem,
} from '../row/sessionListRowModelTypes';
import { buildSessionBulkActionTargetFromSessionItem } from './buildSessionBulkActionTarget';

const SERVER_ID = 'server_a';

function createSession(id: string): SessionListRenderableSession {
    return {
        id,
        active: false,
        archivedAt: null,
        owner: 'user_1',
        accessLevel: undefined,
        seq: 4,
        lastViewedSessionSeq: 4,
        latestTurnStatus: 'completed',
        createdAt: 1,
        updatedAt: 1,
        activeAt: 0,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 1,
    };
}

function createItem(id: string): SessionListSessionItem {
    return {
        type: 'session',
        session: createSession(id),
        serverId: SERVER_ID,
        groupKey: 'group-a',
        groupKind: 'date',
    };
}

function createSettings(params: Readonly<{
    attentionStandingEnabled: boolean;
    attentionStandingPolicy: SessionAttentionStandingPolicy;
}>): SessionListRowPresentationSettings {
    return {
        currentUserId: 'user_1',
        density: 'default',
        compact: false,
        compactMinimal: false,
        identityDisplay: 'avatar',
        activeColorMode: 'activityAndAttention',
        workingIndicatorMode: 'spinner',
        workingTextMode: 'static',
        statusColors: {
            connected: '#0f0',
            connecting: '#ff0',
            actionRequired: '#f80',
            disconnected: '#888',
            error: '#f00',
            default: '#000',
        },
        hideInactiveSessions: false,
        showServerBadge: false,
        showPinnedServerBadge: false,
        agentActivityCountEnabled: false,
        tagsEnabled: false,
        sessionTagsByKey: {},
        allKnownTags: [],
        pinnedSessionKeys: [],
        attentionStandingEnabled: params.attentionStandingEnabled,
        attentionStandingPolicy: params.attentionStandingPolicy,
        hasMultipleMachines: false,
        reachableSessionDisplayByKey: {},
        folderViewEnabled: false,
        relativeNowMs: 1_000,
        runtimeNowMs: 1_000,
    };
}

function listBulkActionIds(targetIds: readonly string[], settings: SessionListRowPresentationSettings): string[] {
    const targets = targetIds.map((id) => buildSessionBulkActionTargetFromSessionItem(createItem(id), settings));
    return listSessionBulkActionDescriptors({
        targets,
        tagsEnabled: false,
        moveEnabled: false,
    }).map((descriptor) => descriptor.id);
}

describe('buildSessionBulkActionTargetFromSessionItem attention standing', () => {
    const standingSettings = createSettings({
        attentionStandingEnabled: true,
        attentionStandingPolicy: {
            defaultStanding: false,
            overridesBySessionKey: { [`${SERVER_ID}:sess_standing`]: true },
        },
    });

    it('offers Remove from Needs attention for a selection holding a standing session', () => {
        expect(listBulkActionIds(['sess_standing'], standingSettings))
            .toContain(SESSION_BULK_ACTION_IDS.clearAttentionStanding);
        expect(listBulkActionIds(['sess_standing'], standingSettings))
            .not.toContain(SESSION_BULK_ACTION_IDS.setAttentionStanding);
    });

    it('offers Keep in Needs attention for a selection holding a non-standing session', () => {
        expect(listBulkActionIds(['sess_plain'], standingSettings))
            .toContain(SESSION_BULK_ACTION_IDS.setAttentionStanding);
        expect(listBulkActionIds(['sess_plain'], standingSettings))
            .not.toContain(SESSION_BULK_ACTION_IDS.clearAttentionStanding);
    });

    it('offers both directions for a mixed selection', () => {
        const ids = listBulkActionIds(['sess_standing', 'sess_plain'], standingSettings);

        expect(ids).toContain(SESSION_BULK_ACTION_IDS.setAttentionStanding);
        expect(ids).toContain(SESSION_BULK_ACTION_IDS.clearAttentionStanding);
    });

    it('offers neither direction while the attention band is off', () => {
        const settings = createSettings({
            attentionStandingEnabled: false,
            attentionStandingPolicy: {
                defaultStanding: false,
                overridesBySessionKey: { [`${SERVER_ID}:sess_standing`]: true },
            },
        });
        const ids = listBulkActionIds(['sess_standing', 'sess_plain'], settings);

        expect(ids).not.toContain(SESSION_BULK_ACTION_IDS.setAttentionStanding);
        expect(ids).not.toContain(SESSION_BULK_ACTION_IDS.clearAttentionStanding);
    });
});

describe('buildSessionBulkActionTargetFromSessionItem delete', () => {
    const settings = createSettings({
        attentionStandingEnabled: false,
        attentionStandingPolicy: { defaultStanding: false, overridesBySessionKey: {} },
    });

    it('offers Delete for the owner\'s sessions, stopping a running one first and knowing a linked one, as the row menu does', () => {
        const idle = buildSessionBulkActionTargetFromSessionItem(createItem('sess_idle'), settings);
        const runningItem = createItem('sess_running');
        const running = buildSessionBulkActionTargetFromSessionItem(
            { ...runningItem, session: { ...runningItem.session, active: true } },
            settings,
        );
        const sharedItem = createItem('sess_shared');
        const shared = buildSessionBulkActionTargetFromSessionItem(
            { ...sharedItem, session: { ...sharedItem.session, owner: 'user_2', accessLevel: 'edit' } },
            settings,
        );

        const linkedItem = createItem('sess_linked');
        const linked = buildSessionBulkActionTargetFromSessionItem(
            { ...linkedItem, session: { ...linkedItem.session, metadata: { path: '/w', directSessionV1: { v: 1, providerId: 'codex' } } } },
            settings,
        );

        expect(idle).toMatchObject({ canDelete: true, stopsBeforeDelete: false, linked: false });
        expect(linked).toMatchObject({ canDelete: true, linked: true });
        expect(running).toMatchObject({ canDelete: true, stopsBeforeDelete: true });
        expect(shared).toMatchObject({ canDelete: false });
        expect(listBulkActionIds(['sess_idle'], settings)).toContain(SESSION_BULK_ACTION_IDS.delete);
    });
});
