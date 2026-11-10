import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DEFAULT_NOW_MS_INTERVAL_MS, readNowMs, subscribeToNowMs } from '@/hooks/time/nowMsClockStore';
import { useIsHostVisible } from '@/hooks/ui/useIsHostVisible';
import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { Text } from '@/components/ui/text/Text';
import { groupTrashedSessionsByDay, trashDaysLeft } from '@/sync/domains/session/trash/groupTrashedSessionsByDay';
import { useSessionTrashStore } from '@/sync/domains/session/trash/sessionTrashStore';
import type { Session } from '@/sync/domains/state/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { getSessionAvatarId, getSessionName, getSessionSubtitle } from '@/utils/sessions/sessionUtils';

import { deleteTrashedSessionNow, emptyTrash, restoreTrashedSession } from './sessionTrashActions';

/**
 * The shared minute clock, subscribed only while the window is on screen: the runtime-active gate behind
 * `useNowMs` is always on for the desktop (Tauri) shell, so a hidden desktop window would otherwise keep its
 * timer notifications and re-renders. Showing the window again re-reads the clock once.
 */
function useVisibleNowMs(): number {
    const visible = useIsHostVisible();
    const lastNowMs = React.useRef(readNowMs(DEFAULT_NOW_MS_INTERVAL_MS));
    const subscribe = React.useCallback(
        (listener: () => void) => (visible ? subscribeToNowMs(DEFAULT_NOW_MS_INTERVAL_MS, listener) : () => undefined),
        [visible],
    );
    const getSnapshot = React.useCallback(() => {
        if (visible) lastNowMs.current = readNowMs(DEFAULT_NOW_MS_INTERVAL_MS);
        return lastNowMs.current;
    }, [visible]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function dayLabel(daysAgo: number): string {
    if (daysAgo <= 0) return t('sessionTrash.today');
    if (daysAgo === 1) return t('sessionTrash.yesterday');
    return t('sessionTrash.daysAgo', { count: daysAgo });
}

/** Folder, then machine, then how long the session stays in the trash. */
function rowSubtitle(session: Session, nowMs: number): string {
    const host = typeof session.metadata?.host === 'string' ? session.metadata.host.trim() : '';
    const where = [getSessionSubtitle(session), host].filter(Boolean).join(' · ');
    let left = '';
    if (typeof session.trashedAt === 'number') {
        const days = trashDaysLeft(session.trashedAt, nowMs);
        left = days === 0 ? t('sessionTrash.expiring') : t('sessionTrash.daysLeft', { count: days });
    }
    return [where, left].filter(Boolean).join(' · ');
}

const TrashedSessionRow = React.memo(function TrashedSessionRow(props: Readonly<{ session: Session; nowMs: number }>) {
    const { session, nowMs } = props;
    const title = getSessionName(session);
    const actions = React.useMemo((): ItemAction[] => [
        {
            id: 'restore',
            title: t('sessionTrash.restore'),
            icon: 'arrow-arc-left',
            onPress: () => fireAndForget(restoreTrashedSession(session), { tag: 'SessionTrash.restore' }),
        },
        {
            id: 'delete_now',
            title: t('sessionTrash.deleteNow'),
            icon: 'trash',
            destructive: true,
            onPress: () => fireAndForget(deleteTrashedSessionNow(session), { tag: 'SessionTrash.deleteNow' }),
        },
    ], [session]);

    return (
        <Item
            title={title}
            subtitle={rowSubtitle(session, nowMs)}
            subtitleLines={1}
            leftElement={<Avatar id={getSessionAvatarId(session)} size={40} />}
            mode="info"
            rightElement={(
                <ItemRowActions
                    title={title}
                    actions={actions}
                    compactThreshold={Number.POSITIVE_INFINITY}
                    compactActionIds={[]}
                />
            )}
        />
    );
});

/** The trash (回收站): deleted sessions grouped by the day they were deleted, restorable until they expire. */
export function SessionTrashScreen() {
    const { theme } = useUnistyles();
    const sessions = useSessionTrashStore((state) => state.sessions);
    const status = useSessionTrashStore((state) => state.status);
    const complete = useSessionTrashStore((state) => state.complete);
    const nowMs = useVisibleNowMs();
    const groups = React.useMemo(() => groupTrashedSessionsByDay(sessions ?? [], nowMs), [nowMs, sessions]);

    const reload = React.useCallback(() => {
        fireAndForget(sync.refreshTrashedSessions(), { tag: 'SessionTrash.refresh' });
    }, []);
    React.useEffect(reload, [reload]);

    const handleEmpty = React.useCallback(() => {
        // Only the whole trash may be emptied: the button is off until every page and row was read.
        if (!complete) return;
        fireAndForget(emptyTrash(sessions ?? []), { tag: 'SessionTrash.empty' });
    }, [complete, sessions]);

    const hasRows = (sessions?.length ?? 0) > 0;
    if (!hasRows) {
        // Never "empty" before a read finished successfully and completely; a read that ended with nothing
        // decrypted (every row failed) offers a retry instead of waiting forever.
        const needsRetry = status === 'error' || (status === 'ready' && !complete);
        const message = status === 'error'
            ? t('sessionTrash.loadFailed')
            : status === 'ready' && complete
                ? t('sessionTrash.empty')
                : status === 'ready'
                    ? t('sessionTrash.partial')
                    : t('common.loading');
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
                <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>{message}</Text>
                {needsRetry ? (
                    <Item title={t('common.retry')} icon={<Icon name="arrow-clockwise" size={20} color={theme.colors.text.secondary} />} onPress={reload} />
                ) : null}
            </View>
        );
    }

    return (
        <ItemList>
            <ItemGroup footer={status === 'error' ? t('sessionTrash.loadFailed') : complete ? t('sessionTrash.description') : t('sessionTrash.partial')}>
                <Item
                    title={t('sessionTrash.emptyTrash')}
                    icon={<Icon name="trash" size={20} color={theme.colors.text.destructive} />}
                    destructive
                    disabled={!complete}
                    onPress={handleEmpty}
                />
                {status === 'error' || !complete ? (
                    <Item title={t('common.retry')} icon={<Icon name="arrow-clockwise" size={20} color={theme.colors.text.secondary} />} onPress={reload} />
                ) : null}
            </ItemGroup>
            {groups.map((group) => (
                <ItemGroup key={group.daysAgo} title={dayLabel(group.daysAgo)}>
                    {group.sessions.map((session) => (
                        <TrashedSessionRow key={session.id} session={session} nowMs={nowMs} />
                    ))}
                </ItemGroup>
            ))}
        </ItemList>
    );
}
