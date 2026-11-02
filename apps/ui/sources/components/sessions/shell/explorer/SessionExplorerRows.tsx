import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { isHoverCapablePrimaryPointer } from '@/utils/platform/webMobileHeuristics';

type ExplorerHeader = Extract<SessionListViewItem, { type: 'header' }>;
export type SessionExplorerNodeKind = NonNullable<ExplorerHeader['explorerNodeKind']>;
export type SessionExplorerStatusKind = NonNullable<ExplorerHeader['explorerStatus']>;

const INDENT_BASE = 12;
const INDENT_STEP = 14;
const CHEVRON_SLOT = 16;
const CHEVRON_GAP = 2;

/** Where a row's icon starts at `depth`: a folder's icon, a session's agent mark and a note line up. */
export function sessionExplorerIconInset(depth: number): number {
    return INDENT_BASE + Math.max(0, Math.trunc(depth)) * INDENT_STEP + CHEVRON_SLOT + CHEVRON_GAP;
}

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        minHeight: 30,
        paddingRight: 8,
        marginHorizontal: 4,
        borderRadius: 6,
    },
    rowHovered: {
        backgroundColor: theme.colors.surface.pressed,
    },
    toggle: {
        flex: 1,
        minWidth: 0,
        alignSelf: 'stretch' as const,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 6,
    },
    chevron: {
        width: CHEVRON_SLOT,
        marginRight: CHEVRON_GAP - 6,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    pressed: {
        opacity: 0.7,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        color: theme.colors.text.primary,
        ...Typography.default(),
    },
    titleStrong: {
        ...Typography.default('semiBold'),
    },
    titleQuiet: {
        color: theme.colors.text.secondary,
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
        width: 24,
        height: 24,
        marginLeft: 4,
        borderRadius: 6,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    newSessionButtonHidden: {
        opacity: 0,
    },
    statusRow: {
        minHeight: 26,
        justifyContent: 'center' as const,
        paddingRight: 12,
    },
    statusText: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
}));

function folderIcon(kind: SessionExplorerNodeKind, expanded: boolean): IconName {
    if (kind === 'machine') return 'desktop';
    if (kind === 'other') return 'stack';
    return expanded ? 'folder-open' : 'folder';
}

export type SessionExplorerFolderRowProps = Readonly<{
    title: string;
    depth: number;
    kind: SessionExplorerNodeKind;
    expanded: boolean;
    sessionCount: number;
    activeSessionCount: number;
    onToggle: () => void;
    /** Starts a session in this folder; null where no session can start (a machine row). */
    onCreateSession: (() => void) | null;
    testID?: string;
}>;

/**
 * One folder of the session explorer, VS Code style: chevron, folder, name, then how many sessions
 * sit below it and a dot while one runs. Pressing the row opens or closes it; + starts a session
 * in the folder. On a pointer that hovers, + shows on hover, focus and open folders; elsewhere always.
 */
export const SessionExplorerFolderRow = React.memo(function SessionExplorerFolderRow(props: SessionExplorerFolderRowProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const hoverReveal = React.useMemo(() => isHoverCapablePrimaryPointer(), []);
    const isWeb = Platform.OS === 'web';
    const iconColor = theme.colors.text.secondary;
    const showCreate = !hoverReveal || hovered || focused || props.expanded;
    const a11yLabel = props.kind === 'machine'
        ? t('sessionsList.explorerMachineA11y', { name: props.title, count: props.sessionCount })
        : t('sessionsList.explorerFolderA11y', { name: props.title, count: props.sessionCount });

    // The toggle and + are sibling buttons: a button inside another is merged into it by screen readers.
    return (
        <View
            style={[styles.row, hovered ? styles.rowHovered : null, { paddingLeft: sessionExplorerIconInset(props.depth) - CHEVRON_SLOT - CHEVRON_GAP - 4 }]}
            onPointerEnter={isWeb ? () => setHovered(true) : undefined}
            onPointerLeave={isWeb ? () => setHovered(false) : undefined}
        >
            <Pressable
                testID={props.testID}
                onPress={props.onToggle}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}
                accessibilityRole="button"
                accessibilityState={{ expanded: props.expanded }}
                // RN-Web reads expanded state from `aria-expanded`, not from accessibilityState.
                aria-expanded={props.expanded}
                accessibilityLabel={a11yLabel}
            >
                <View style={styles.chevron}>
                    <Icon name={props.expanded ? 'caret-down' : 'caret-right'} size={12} color={iconColor} />
                </View>
                <Icon name={folderIcon(props.kind, props.expanded)} size={16} color={iconColor} />
                <Text
                    style={[
                        styles.title,
                        props.kind !== 'folder' ? styles.titleStrong : null,
                        props.kind === 'folder' && props.sessionCount === 0 ? styles.titleQuiet : null,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                >
                    {props.title}
                </Text>
                {props.sessionCount > 0 ? (
                    <View style={styles.meta}>
                        {props.activeSessionCount > 0 ? <View style={styles.liveDot} /> : null}
                        <Text testID={props.testID ? `${props.testID}:count` : undefined} style={styles.count}>
                            {props.sessionCount}
                        </Text>
                    </View>
                ) : null}
            </Pressable>
            {props.onCreateSession ? (
                <Pressable
                    testID={props.testID ? `${props.testID}:new-session` : undefined}
                    onPress={props.onCreateSession}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={({ pressed }) => [
                        styles.newSessionButton,
                        showCreate ? null : styles.newSessionButtonHidden,
                        pressed ? styles.pressed : null,
                    ]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionsList.explorerNewSessionA11y', { name: props.title })}
                >
                    <Icon name="plus" size={14} color={iconColor} />
                </Pressable>
            ) : null}
        </View>
    );
});

const STATUS_TEXT_KEYS = {
    loading: 'sessionsList.explorerStatusLoading',
    empty: 'sessionsList.explorerStatusEmpty',
    error: 'sessionsList.explorerStatusError',
    offline: 'sessionsList.explorerStatusOffline',
    truncated: 'sessionsList.explorerStatusTruncated',
} as const satisfies Record<SessionExplorerStatusKind, string>;

export type SessionExplorerStatusRowProps = Readonly<{
    status: SessionExplorerStatusKind;
    depth: number;
    /** Lists the folder again; offered for a failed listing. */
    onRetry?: (() => void) | null;
    testID?: string;
}>;

/** A quiet note under an open folder that shows nothing (yet), or whose listing was cut short. */
export const SessionExplorerStatusRow = React.memo(function SessionExplorerStatusRow(props: SessionExplorerStatusRowProps) {
    const styles = stylesheet;
    const text = t(STATUS_TEXT_KEYS[props.status]);
    const inset = { paddingLeft: sessionExplorerIconInset(props.depth) };
    if (props.status === 'error' && props.onRetry) {
        return (
            <Pressable
                testID={props.testID}
                onPress={props.onRetry}
                style={({ pressed }) => [styles.statusRow, inset, pressed ? styles.pressed : null]}
                accessibilityRole="button"
                accessibilityLabel={text}
            >
                <Text style={styles.statusText} numberOfLines={2}>{text}</Text>
            </Pressable>
        );
    }
    return (
        <View testID={props.testID} style={[styles.statusRow, inset]}>
            <Text style={styles.statusText} numberOfLines={2}>{text}</Text>
        </View>
    );
});
