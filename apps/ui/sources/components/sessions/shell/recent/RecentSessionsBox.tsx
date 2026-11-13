import React from 'react';
import { View } from 'react-native';

import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { t } from '@/text';

import { CollapsibleSectionHeader } from '../CollapsibleSectionHeader';

type SessionRow = Extract<SessionListViewItem, { type: 'session' }>;

/**
 * The 「最近」 box above the session list: the few sessions used last, each as its own list row (which
 * shows a running turn, a finished one not yet opened, or a prompt waiting for the user), so they are
 * found without opening folders. It stays put while the list scrolls; its header folds it.
 */
export const RecentSessionsBox = React.memo(function RecentSessionsBox(props: Readonly<{
    rows: ReadonlyArray<SessionRow>;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    renderRow: (row: SessionRow, index: number, rows: ReadonlyArray<SessionRow>) => React.ReactNode;
}>) {
    if (props.rows.length === 0) return null;
    return (
        <View testID="session-list-recent-box">
            <CollapsibleSectionHeader
                title={t('sessionsList.recentSectionTitle')}
                headerKind="recent"
                collapsed={props.collapsed}
                onPress={props.onToggleCollapsed}
                headerTestId="session-list-recent-header"
            />
            {props.collapsed ? null : props.rows.map((row, index) => (
                <React.Fragment key={`recent:${row.serverId ?? ''}:${row.session.id}`}>
                    {props.renderRow(row, index, props.rows)}
                </React.Fragment>
            ))}
        </View>
    );
});
