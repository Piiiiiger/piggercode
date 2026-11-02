import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { SessionListViewItem } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { isHoverCapablePrimaryPointer } from '@/utils/platform/webMobileHeuristics';

import {
    SESSION_EXPLORER_CHEVRON_GAP,
    SESSION_EXPLORER_CHEVRON_SLOT,
    sessionExplorerIconInset,
} from './sessionExplorerLayout';
import {
    hasSessionExplorerFolderActions,
    SessionExplorerFolderMenu,
    type SessionExplorerFolderActions,
} from './SessionExplorerFolderMenu';

type ExplorerHeader = Extract<SessionListViewItem, { type: 'header' }>;
export type SessionExplorerNodeKind = NonNullable<ExplorerHeader['explorerNodeKind']>;
export type SessionExplorerStatusKind = NonNullable<ExplorerHeader['explorerStatus']>;

const CHEVRON_SLOT = SESSION_EXPLORER_CHEVRON_SLOT;
const CHEVRON_GAP = SESSION_EXPLORER_CHEVRON_GAP;

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
    /** What the folder's ⋯ and right-click (long-press on phones) menu offers; null for no menu. */
    folderActions?: SessionExplorerFolderActions | null;
    testID?: string;
}>;

/**
 * One folder of the session explorer, VS Code style: chevron, folder, name, then how many sessions
 * sit below it and a dot while one runs. Pressing the row opens or closes it; + starts a session
 * in the folder; ⋯, a right-click or a long press opens the folder's menu. On a pointer that hovers,
 * + and ⋯ show on hover, focus, open folders and while the menu is open; elsewhere always. The menu
 * itself mounts only while open.
 */
export const SessionExplorerFolderRow = React.memo(function SessionExplorerFolderRow(props: SessionExplorerFolderRowProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    // Where the open menu hangs: from ⋯, or below the row after a right-click or long press.
    const [menuAnchor, setMenuAnchor] = React.useState<'button' | 'row' | null>(null);
    const rowRef = React.useRef<View>(null);
    const menuButtonRef = React.useRef<View>(null);
    const hoverReveal = React.useMemo(() => isHoverCapablePrimaryPointer(), []);
    const isWeb = Platform.OS === 'web';
    const iconColor = theme.colors.text.secondary;
    const showCreate = !hoverReveal || hovered || focused || props.expanded || menuAnchor !== null;
    const hasMenu = hasSessionExplorerFolderActions(props.folderActions);
    const closeMenu = React.useCallback(() => setMenuAnchor(null), []);
    // Web only: a right-click opens the folder's menu instead of the browser's.
    const rowContextMenuProps = isWeb && hasMenu ? {
        onContextMenu: (event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
            event.preventDefault?.();
            event.stopPropagation?.();
            setMenuAnchor('row');
        },
    } : {};
    const a11yLabel = props.kind === 'machine'
        ? t('sessionsList.explorerMachineA11y', { name: props.title, count: props.sessionCount })
        : t('sessionsList.explorerFolderA11y', { name: props.title, count: props.sessionCount });

    // The toggle and + are sibling buttons: a button inside another is merged into it by screen readers.
    return (
        <View
            ref={rowRef}
            collapsable={false}
            testID={props.testID ? `${props.testID}:row` : undefined}
            style={[styles.row, hovered ? styles.rowHovered : null, { paddingLeft: sessionExplorerIconInset(props.depth) - CHEVRON_SLOT - CHEVRON_GAP - 4 }]}
            onPointerEnter={isWeb ? () => setHovered(true) : undefined}
            onPointerLeave={isWeb ? () => setHovered(false) : undefined}
            {...rowContextMenuProps}
        >
            <Pressable
                testID={props.testID}
                onPress={props.onToggle}
                onLongPress={!isWeb && hasMenu ? () => setMenuAnchor('row') : undefined}
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
            {hasMenu ? (
                <Pressable
                    ref={menuButtonRef}
                    testID={props.testID ? `${props.testID}:menu` : undefined}
                    onPress={(event) => {
                        event?.stopPropagation?.();
                        setMenuAnchor((anchor) => (anchor ? null : 'button'));
                    }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    style={({ pressed }) => [
                        styles.newSessionButton,
                        showCreate ? null : styles.newSessionButtonHidden,
                        pressed ? styles.pressed : null,
                    ]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.moreActions')}
                >
                    <Icon name="dots-three" size={14} color={iconColor} />
                </Pressable>
            ) : null}
            {menuAnchor && props.folderActions ? (
                <SessionExplorerFolderMenu
                    actions={props.folderActions}
                    anchorRef={menuAnchor === 'row' ? rowRef : menuButtonRef}
                    placement={menuAnchor === 'row' ? 'bottom' : 'left'}
                    onClose={closeMenu}
                />
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
