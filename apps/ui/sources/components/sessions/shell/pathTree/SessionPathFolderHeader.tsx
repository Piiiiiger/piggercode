import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const INDENT_BASE = 16;
const INDENT_STEP = 12;
// Session rows stop indenting after three levels (SessionItem); folders follow so rows stay under them.
const INDENT_CAP = 3;

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        minHeight: 32,
        paddingRight: 12,
        gap: 6,
        backgroundColor: theme.colors.background.canvas,
    },
    toggle: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        paddingVertical: 4,
    },
    pressed: {
        opacity: 0.7,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    meta: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
        flexShrink: 0,
    },
    count: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        fontVariant: ['tabular-nums' as const],
        ...Typography.default(),
    },
    liveDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: theme.colors.status.connected,
    },
    newSessionButton: {
        width: 22,
        height: 22,
        borderRadius: 6,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
}));

export type SessionPathFolderHeaderProps = Readonly<{
    title: string;
    depth: number;
    sessionCount: number;
    activeSessionCount: number;
    collapsed: boolean;
    onToggleCollapse: () => void;
    /** Starts a session in this folder; omitted when the folder's location is unknown. */
    onCreateSession?: (() => void) | null;
    testID?: string;
}>;

/** A folder of the session list's path tree: press to fold it, + to start a session in it. */
export const SessionPathFolderHeader = React.memo(function SessionPathFolderHeader(props: SessionPathFolderHeaderProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const indent = INDENT_BASE + Math.max(0, Math.min(INDENT_CAP, Math.trunc(props.depth))) * INDENT_STEP;
    const iconColor = theme.colors.text.secondary;

    // The toggle and + are sibling buttons: a button inside another is merged into it by screen readers.
    return (
        <View style={[styles.row, { paddingLeft: indent }]}>
            <Pressable
                testID={props.testID}
                onPress={props.onToggleCollapse}
                style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}
                accessibilityRole="button"
                accessibilityState={{ expanded: !props.collapsed }}
                accessibilityLabel={t('sessionsList.pathFolderA11y', { name: props.title, count: props.sessionCount })}
            >
                <Icon name={props.collapsed ? 'caret-right' : 'caret-down'} size={12} color={iconColor} />
                <Icon name={props.collapsed ? 'folder' : 'folder-open'} size={16} color={iconColor} />
                <Text style={styles.title} numberOfLines={1}>{props.title}</Text>
                <View style={styles.meta}>
                    {props.activeSessionCount > 0 ? <View style={styles.liveDot} /> : null}
                    <Text style={styles.count}>{props.sessionCount}</Text>
                </View>
            </Pressable>
            {props.onCreateSession ? (
                <Pressable
                    testID={props.testID ? `${props.testID}:new-session` : undefined}
                    onPress={props.onCreateSession}
                    style={({ pressed }) => [styles.newSessionButton, pressed ? styles.pressed : null]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionsList.pathFolderNewSessionA11y', { name: props.title })}
                >
                    <Icon name="plus" size={14} color={iconColor} />
                </Pressable>
            ) : null}
        </View>
    );
});
