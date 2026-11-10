import * as React from 'react';
import { useSessionArchivePending } from '@/hooks/session/useSessionArchivePending';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import { useNavigateToSession } from '@/hooks/session/useNavigateToSession';

import { storage, useSessionOrganizationProjection, useSettings } from '@/sync/domains/state/storage';
import { useSessionAttentionStandingInputs } from '@/hooks/session/useSessionAttentionStandingInputs';
import { resolveSessionAttentionStanding } from '@/sync/domains/session/organization/attentionStanding';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { sessionTagKey } from '@/components/sessions/shell/sessionTagUtils';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { StorageState } from '@/sync/store/types';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { Modal } from '@/modal';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import { createSessionActionTarget } from '@/components/sessions/actions/sessionActionContext';
import { confirmSessionStop, executeSessionAction } from '@/components/sessions/actions/sessionActionExecution';
import { listVisibleSessionActionIds } from '@/components/sessions/actions/sessionActionAvailability';
import { createSessionActionDropdownItem } from '@/components/sessions/actions/sessionActionPresentation';
import {
  resolveAttentionStandingFromSessionActionId,
  resolveManualReadStateFromSessionActionId,
  SESSION_ACTION_ARCHIVE_ID,
  SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID,
  SESSION_ACTION_MARK_READ_ID,
  SESSION_ACTION_MARK_UNREAD_ID,
  SESSION_ACTION_RENAME_ID,
  SESSION_ACTION_RESUME_ID,
  SESSION_ACTION_SET_ATTENTION_STANDING_ID,
  SESSION_ACTION_STOP_ID,
  SESSION_ACTION_UNARCHIVE_ID,
} from '@/components/sessions/actions/sessionActionIds';
import { buildSessionMetadataStabilitySignature } from '@/sync/domains/session/metadata/sessionMetadataStability';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { resolveSessionHeaderActionTargetPx, SESSION_HEADER_ICON_SIZE_PX } from '@/components/sessions/actions/sessionHeaderIconMetrics';
import { Icon } from '@/components/ui/icons/Icon';
import { emitSessionResumeRequest } from '@/components/sessions/model/sessionResumeRequests';

type SessionHeaderActionMenuProps = Readonly<{
  sessionId: string;
  session: Session;
  /**
   * Optional extra items to include in the action menu (typically from adjacent header icon actions
   * that are folded into the three-dots menu on narrow layouts).
   *
   * Extra item IDs must not collide with protocol action spec IDs.
   */
  extraItems?: ReadonlyArray<DropdownMenuItem>;
  /**
   * Optional handler for selecting extra items. Return `true` when the selection was handled.
   * This is primarily used to bridge extra items that need access to parent-owned state (e.g.
   * opening a pane tab) without adding new cross-cutting dependencies here.
   */
  onSelectExtraItem?: (actionId: string) => boolean;
}>;

function readCurrentSessionForOpenMenu(sessionId: string, fallback: Session): Session {
  return storage.getState().sessions[sessionId] ?? fallback;
}

function signatureValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return '';
}

function readLegacyReadStateMetadata(metadata: unknown): Readonly<{
  sessionSeq: unknown;
  pendingActivityAt: unknown;
}> {
  if (!metadata || typeof metadata !== 'object') {
    return { sessionSeq: null, pendingActivityAt: null };
  }
  const readStateV1 = (metadata as { readStateV1?: unknown }).readStateV1;
  if (!readStateV1 || typeof readStateV1 !== 'object') {
    return { sessionSeq: null, pendingActivityAt: null };
  }
  return {
    sessionSeq: (readStateV1 as { sessionSeq?: unknown }).sessionSeq,
    pendingActivityAt: (readStateV1 as { pendingActivityAt?: unknown }).pendingActivityAt,
  };
}

function buildSessionHeaderReadStateSignature(
  state: Pick<StorageState, 'sessions' | 'sessionListRenderables' | 'sessionMessages'>,
  sessionId: string,
): string {
  const session = state.sessions[sessionId];
  const renderable = state.sessionListRenderables[sessionId];
  const messages = state.sessionMessages[sessionId] as Readonly<{
    messageIdsOldestFirst?: ReadonlyArray<unknown>;
    messagesVersion?: unknown;
    reducerVersion?: unknown;
    latestReadyEventSeq?: unknown;
    latestReadyEventAt?: unknown;
  }> | undefined;
  const readStateV1 = readLegacyReadStateMetadata(session?.metadata);

  return [
    signatureValue(session?.seq),
    signatureValue(session?.lastViewedSessionSeq),
    signatureValue(session?.latestReadyEventSeq),
    signatureValue((session as { latestMessageSeq?: unknown } | undefined)?.latestMessageSeq),
    signatureValue(session?.latestTurnStatus),
    signatureValue(session?.accessLevel),
    signatureValue(readStateV1.sessionSeq),
    signatureValue(readStateV1.pendingActivityAt),
    signatureValue(renderable?.hasUnreadMessages),
    signatureValue(renderable?.seq),
    signatureValue(renderable?.lastViewedSessionSeq),
    signatureValue(messages?.messagesVersion),
    signatureValue(messages?.reducerVersion),
    signatureValue(messages?.latestReadyEventSeq),
    signatureValue(messages?.latestReadyEventAt),
    signatureValue(messages?.messageIdsOldestFirst?.length),
  ].join('|');
}

function areSessionActionMenuMetadataSemanticallyEqual(
  prev: Session['metadata'],
  next: Session['metadata'],
): boolean {
  if (prev === next) return true;
  return buildSessionMetadataStabilitySignature(prev) === buildSessionMetadataStabilitySignature(next);
}

function didSessionHeaderActionMenuPropsChange(
  prev: SessionHeaderActionMenuProps,
  next: SessionHeaderActionMenuProps,
): boolean {
  if (prev.sessionId !== next.sessionId) return true;
  if (prev.extraItems !== next.extraItems) return true;
  if (prev.onSelectExtraItem !== next.onSelectExtraItem) return true;
  if (!areSessionActionMenuMetadataSemanticallyEqual(prev.session.metadata, next.session.metadata)) return true;
  if (prev.session.active !== next.session.active) return true;
  if (prev.session.owner !== next.session.owner) return true;
  if (prev.session.archivedAt !== next.session.archivedAt) return true;
  if (prev.session.accessLevel !== next.session.accessLevel) return true;
  return (prev.session.seq > 0) !== (next.session.seq > 0);
}

function SessionHeaderActionMenuInner(props: SessionHeaderActionMenuProps) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const navigateToSession = useNavigateToSession();
  const settings = useSettings();
  const sessionServerId = usePreferredServerIdForSession(props.sessionId);
  const archivePending = useSessionArchivePending(props.sessionId, sessionServerId);
  const readStateSignature = storage((state) =>
    buildSessionHeaderReadStateSignature(state, props.sessionId),
  );
  const [open, setOpen] = React.useState(false);
  const session = React.useMemo(
    () => open ? readCurrentSessionForOpenMenu(props.sessionId, props.session) : props.session,
    [open, props.session, props.sessionId],
  );
  const organizationProjection = useSessionOrganizationProjection(sessionServerId ?? null);
  const organizationListViewState = React.useMemo(() => buildSessionOrganizationListViewState({
    serverId: sessionServerId ?? '',
    projection: organizationProjection,
  }), [organizationProjection, sessionServerId]);
  const attentionStanding = useSessionAttentionStandingInputs(
    organizationListViewState.attentionStandingOverridesBySessionKey,
  );
  const sessionAttentionStandingKey = typeof sessionServerId === 'string' && sessionServerId.trim()
    ? sessionTagKey(sessionServerId, props.sessionId)
    : null;
  const attentionStandingEnabled = attentionStanding.actionEnabled && sessionAttentionStandingKey != null;
  const isAttentionStandingSession = sessionAttentionStandingKey != null
    && resolveSessionAttentionStanding(attentionStanding.policy, sessionAttentionStandingKey);
  const sessionActionTarget = React.useMemo(
    () => createSessionActionTarget({
      session,
      serverId: sessionServerId ?? null,
      currentUserId: !session.accessLevel && typeof session.owner === 'string' ? session.owner : null,
      isConnected: session.active === true,
      isPinned: false,
      attentionStandingEnabled,
      attentionStanding: isAttentionStandingSession,
      resumeCapabilityOptions: { accountSettings: settings },
    }),
    [attentionStandingEnabled, isAttentionStandingSession, readStateSignature, session, sessionServerId, settings],
  );
  const actions = React.useMemo(() => {
    const out: DropdownMenuItem[] = [];

    if (Array.isArray(props.extraItems) && props.extraItems.length > 0) {
      out.push(...props.extraItems);
    }

    const existingActionIds = new Set(out.map((item) => item.id));
    for (const actionId of listVisibleSessionActionIds({
      target: sessionActionTarget,
      surface: 'sessionHeader',
    })) {
      if (existingActionIds.has(actionId)) continue;
      const actionItem = createSessionActionDropdownItem({
        actionId,
        iconColor: theme.colors.chrome.header.foreground,
      });
      if (actionItem) {
        out.push(archivePending && (actionId === SESSION_ACTION_ARCHIVE_ID || actionId === SESSION_ACTION_STOP_ID)
          ? { ...actionItem, disabled: true }
          : actionItem);
        existingActionIds.add(actionId);
      }
    }

    return out;
  }, [
    props.extraItems,
    archivePending,
    sessionActionTarget,
    theme.colors.chrome.header.foreground,
  ]);

  if (actions.length === 0) return null;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      items={actions}
      onSelect={(actionId) => {
        setOpen(false);
        if (props.onSelectExtraItem?.(actionId) === true) return;
        const manualReadState = resolveManualReadStateFromSessionActionId(actionId);
        if (manualReadState) {
          const sessionActionId = manualReadState === 'read'
            ? SESSION_ACTION_MARK_READ_ID
            : SESSION_ACTION_MARK_UNREAD_ID;
          fireAndForget((async () => {
            try {
              await executeSessionAction({
                actionId: sessionActionId,
                target: sessionActionTarget,
              });
            } catch (error) {
              Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t(
                  manualReadState === 'read'
                    ? 'sessionInfo.failedToMarkSessionRead'
                    : 'sessionInfo.failedToMarkSessionUnread',
                ),
              );
            }
          })(), { tag: 'SessionHeaderActionMenu.execute.sessionReadState' });
          return;
        }
        const nextAttentionStanding = resolveAttentionStandingFromSessionActionId(actionId);
        if (nextAttentionStanding !== null) {
          const attentionStandingActionId = nextAttentionStanding
            ? SESSION_ACTION_SET_ATTENTION_STANDING_ID
            : SESSION_ACTION_CLEAR_ATTENTION_STANDING_ID;
          fireAndForget((async () => {
            try {
              await executeSessionAction({
                actionId: attentionStandingActionId,
                target: sessionActionTarget,
              });
            } catch (error) {
              Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('errors.unknownError'),
              );
            }
          })(), { tag: 'SessionHeaderActionMenu.execute.sessionAttentionStanding' });
          return;
        }
        if (actionId === SESSION_ACTION_RENAME_ID) {
          fireAndForget((async () => {
            const title = await Modal.prompt(
              t('sessionInfo.renameSession'),
              t('sessionInfo.renameSessionSubtitle'),
              {
                defaultValue: getSessionName(session),
                placeholder: t('sessionInfo.renameSessionPlaceholder'),
                confirmText: t('common.save'),
                cancelText: t('common.cancel'),
              },
            );
            if (!title?.trim()) return;
            try {
              await executeSessionAction({
                actionId: SESSION_ACTION_RENAME_ID,
                target: sessionActionTarget,
                input: { title },
              });
            } catch (error) {
              Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('sessionInfo.failedToRenameSession'),
              );
            }
          })(), { tag: 'SessionHeaderActionMenu.execute.sessionRename' });
          return;
        }
        if (actionId === SESSION_ACTION_RESUME_ID) {
          fireAndForget(executeSessionAction({
            actionId: SESSION_ACTION_RESUME_ID,
            target: sessionActionTarget,
            context: {
              operations: {
                resumeSession: async (sessionId) => {
                  await emitSessionResumeRequest(sessionId);
                },
              },
            },
          }), {
            tag: 'SessionHeaderActionMenu.execute.sessionResume',
            onError: () => {
              Modal.alert(t('common.error'), t('session.resumeFailed'));
            },
          });
          return;
        }
        if (actionId === SESSION_ACTION_STOP_ID || actionId === SESSION_ACTION_ARCHIVE_ID) {
          fireAndForget((async () => {
            const isArchive = actionId === SESSION_ACTION_ARCHIVE_ID;
            if (!isArchive) {
              if (!await confirmSessionStop()) return;
            }
            try {
              await executeSessionAction({
                actionId: isArchive ? SESSION_ACTION_ARCHIVE_ID : SESSION_ACTION_STOP_ID,
                target: sessionActionTarget,
              });
            } catch (error) {
              Modal.alert(
                t('common.error'),
                error instanceof Error
                  ? error.message
                  : isArchive
                    ? t('sessionInfo.failedToArchiveSession')
                    : t('sessionInfo.failedToStopSession'),
              );
            }
          })(), { tag: `SessionHeaderActionMenu.execute.${actionId}` });
          return;
        }
        if (actionId === SESSION_ACTION_UNARCHIVE_ID) {
          fireAndForget((async () => {
            try {
              await executeSessionAction({
                actionId: SESSION_ACTION_UNARCHIVE_ID,
                target: sessionActionTarget,
              });
            } catch (error) {
              Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('sessionInfo.failedToUnarchiveSession'),
              );
            }
          })(), { tag: 'SessionHeaderActionMenu.execute.sessionUnarchive' });
          return;
        }
      }}
      trigger={({ toggle }) => (
            <Pressable
              onPress={toggle}
              testID="session-header-action-menu-trigger"
              accessibilityRole="button"
              accessibilityLabel={t('session.actionMenu.openA11y')}
              style={({ pressed }) => ({
                width: resolveSessionHeaderActionTargetPx(),
                height: resolveSessionHeaderActionTargetPx(),
                alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="dots-three" size={SESSION_HEADER_ICON_SIZE_PX} color={theme.colors.chrome.header.foreground} />
          </View>
        </Pressable>
      )}
      placement="bottom"
      variant="slim"
      rowKind="selectableRow"
      search={false}
      matchTriggerWidth={false}
      maxWidthCap={320}
    />
  );
}

export const SessionHeaderActionMenu = React.memo(
  SessionHeaderActionMenuInner,
  (prev, next) => !didSessionHeaderActionMenuPropsChange(prev, next),
);
