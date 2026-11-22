import * as React from 'react';
import {
    I18nManager,
    Pressable,
    ScrollView,
    View,
    type StyleProp,
    type TextStyle,
    type ViewStyle,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { PetCompanionTrayItem } from '@/components/pets/activity';
import {
    ActivitySpinner,
    ICON_CIRCLE_INK_RATIO,
    iconMatchedSpinnerSize,
} from '@/components/ui/feedback/ActivitySpinner';
import { StatusTransition } from '@/components/ui/motion/StatusTransition';
import { resolveVerticalScrollEdgeMaskStyle } from '@/components/ui/scroll/resolveScrollEdgeMaskStyle';
import { useScrollEdgeFades } from '@/components/ui/scroll/useScrollEdgeFades';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { Text, TextInput } from '@/components/ui/text/Text';
import { normalizeKeyboardKeyPressEvent } from '@/keyboard/events';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';

import { styles } from './petCompanionActivityTrayStyles';
import { Icon, type IconName } from '@/components/ui/icons/Icon';

const noDragProps = {
    'data-pet-no-drag': 'true',
    dataSet: { petNoDrag: 'true' },
    className: 'no-drag',
} as const;

type WebBackgroundFillStyle = ViewStyle & Readonly<{
    background?: string;
}>;

type StopPropagationEvent = Readonly<{
    stopPropagation?: () => void;
}>;

type WebStopPropagationProps = Readonly<{
    onClick: (event?: StopPropagationEvent) => void;
    onMouseDown: (event?: StopPropagationEvent) => void;
    onPointerDown: (event?: StopPropagationEvent) => void;
}>;

type QuickReplyKeyPressEvent = StopPropagationEvent & Readonly<{
    preventDefault?: () => void;
    nativeEvent?: Readonly<{
        key?: string;
        code?: string;
        shiftKey?: boolean;
        altKey?: boolean;
        ctrlKey?: boolean;
        metaKey?: boolean;
        repeat?: boolean;
        isComposing?: boolean;
    }>;
}>;

const REPLY_INPUT_LINE_HEIGHT_PX = 17;
const REPLY_INPUT_MAX_LINES = 4;
const REPLY_INPUT_VERTICAL_CHROME_PX = 13;
const REPLY_INPUT_MIN_VISUAL_HEIGHT_PX = 30;
const webReplyInputControlStyle = {
    outlineStyle: 'none',
    resize: 'none',
} as unknown as TextStyle;

function resolveReplyInputLineCount(draft: string): number {
    return Math.min(REPLY_INPUT_MAX_LINES, draft.split(/\r\n|\r|\n/).length);
}

function resolveReplyInputHeight(draft: string): number {
    const lineCount = resolveReplyInputLineCount(draft);
    if (lineCount === 1) return REPLY_INPUT_MIN_VISUAL_HEIGHT_PX;
    return REPLY_INPUT_VERTICAL_CHROME_PX + (lineCount * REPLY_INPUT_LINE_HEIGHT_PX);
}

function resolveReplyInputNumberOfLines(draft: string): number {
    return resolveReplyInputLineCount(draft);
}

export type PetCompanionActivityTrayProps = Readonly<{
    items: readonly PetCompanionTrayItem[];
    open: boolean;
    onOpenItem: (item: PetCompanionTrayItem) => void | Promise<void>;
    onDismissItem: (item: PetCompanionTrayItem) => void;
    onQuickReply: (item: PetCompanionTrayItem, message: string) => void | Promise<void>;
    onInteractionLayoutChange?: () => void;
    externalActiveSessionId?: string | null;
    style?: StyleProp<ViewStyle>;
}>;

/**
 * The three resolvers below map a SESSION's attention state, not an agent-activity status, and are
 * deliberately not folded into `agentActivityToneStyle` / `AgentActivityStatusSlot`.
 *
 * The tray is keyed by `sessionId` and its statuses come from
 * `buildPetCompanionActivityModel` — pending permission/user-action requests, a projected turn
 * failure, `deriveSessionRuntimePresentationState().working`, a finished turn nobody has opened
 * (`review`, the session list's 「待查阅」), unread messages. `review` has no counterpart in the
 * ten-value agent vocabulary at all, and a session is never `queued`, `timedOut` or `cancelled`.
 * Sharing the agent tables here would be the coincidental-similarity kind of centralising: two
 * different questions ("is an agent running" vs "does this session want me") answered by one
 * switch, which then cannot move for either of them.
 *
 * Its real neighbour is the session-list attention owner
 * (`components/sessions/shell/row/sessionRowAttentionColors.ts`), whose `SessionRowAttentionState`
 * covers the same ground with an extra `unread`/`quiet` distinction. Converging those two is a
 * session-attention change, not an agent-activity one. `review` already reads the list's answer and
 * says it in the list's words (`status.readyForReview`).
 */
function resolveStatusLabel(status: PetCompanionTrayItem['status']): string {
    switch (status) {
        case 'waiting':
            return t('settingsPets.overlayStatusWaiting');
        case 'failed':
            return t('settingsPets.overlayStatusFailed');
        case 'review':
            return t('status.readyForReview');
        case 'running':
            return t('settingsPets.overlayStatusRunning');
    }
}

/** The bubble's corner mark: running work spins, every other state is a glyph it settles into. */
type StatusMark = Readonly<{ kind: 'spinner' }> | Readonly<{ kind: 'icon'; name: IconName }>;

/**
 * 15, so the spinner (`iconMatchedSpinnerSize` → 12) draws the dot styles on whole pixels: 2 px dots on a 4 px pitch.
 * At 14 the spinner was 11 px, and its dots blurred into a tint that was hard to see against the bubble.
 */
const STATUS_MARK_SIZE_PX = 15;

function resolveStatusMark(status: PetCompanionTrayItem['status']): StatusMark {
    switch (status) {
        case 'waiting':
            return { kind: 'icon', name: 'clock' };
        case 'failed':
            return { kind: 'icon', name: 'warning' };
        case 'review':
            return { kind: 'icon', name: 'check-circle' };
        case 'running':
            return { kind: 'spinner' };
    }
}

function resolveStatusColor(
    status: PetCompanionTrayItem['status'],
    theme: ReturnType<typeof useUnistyles>['theme'],
): string {
    switch (status) {
        case 'waiting':
            return theme.colors.status.actionRequired;
        case 'failed':
            return theme.colors.status.error;
        case 'review':
            return theme.colors.state.success.foreground;
        case 'running':
            return theme.colors.status.connected;
    }
}

function PetCompanionActivityTrayItemCard(props: Readonly<{
    item: PetCompanionTrayItem;
    active: boolean;
    replyOpen: boolean;
    /** False while the tray is folded away: the running spinner holds still where nobody can see it. */
    animationEnabled: boolean;
    onActiveChange: (item: PetCompanionTrayItem, active: boolean) => void;
    onReplyOpenChange: (item: PetCompanionTrayItem, open: boolean) => void;
    onInteractionLayoutChange?: () => void;
    onOpen: (item: PetCompanionTrayItem) => void | Promise<void>;
    onDismiss: (item: PetCompanionTrayItem) => void;
    onQuickReply: (item: PetCompanionTrayItem, message: string) => void | Promise<void>;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState('');
    const safeSessionId = toTestIdSafeValue(props.item.sessionId);
    const statusLabel = resolveStatusLabel(props.item.status);
    const statusColor = resolveStatusColor(props.item.status, theme);
    const statusMark = resolveStatusMark(props.item.status);
    const isReview = props.item.status === 'review';
    const bubbleTheme = theme.colors.desktopPetOverlay?.bubble ?? {
        background: theme.colors.surface.base,
        backgroundPressed: theme.colors.surface.pressed,
        text: theme.colors.text.primary,
        textSecondary: theme.colors.text.secondary,
        controlBackground: theme.colors.surface.base,
        controlBackgroundPressed: theme.colors.surface.pressed,
    };
    const primaryButtonTheme = theme.colors.button.primary;
    const writingDirection = I18nManager.isRTL ? 'rtl' : 'ltr';
    const { onInteractionLayoutChange } = props;
    const replyOpen = props.replyOpen;
    const active = props.active || replyOpen;
    const replyInputHeight = resolveReplyInputHeight(draft);
    const replyInputNumberOfLines = resolveReplyInputNumberOfLines(draft);
    const replyInputOverflowY = replyInputNumberOfLines >= REPLY_INPUT_MAX_LINES ? 'auto' : 'hidden';
    const trayItemDragProps = React.useMemo(() => ({
        'data-pet-tray-session-id': props.item.sessionId,
        dataSet: { petNoDrag: 'true', petTraySessionId: props.item.sessionId },
    } as const), [props.item.sessionId]);
    const backgroundFillStyle = React.useMemo<WebBackgroundFillStyle>(() => ({
        background: bubbleTheme.background,
        backgroundColor: bubbleTheme.background,
    }), [bubbleTheme.background]);
    const handleSend = React.useCallback(async () => {
        const message = draft.trim();
        if (!message) return;
        await props.onQuickReply(props.item, message);
        setDraft('');
    }, [draft, props]);
    const stopEventPropagation = React.useCallback((event?: StopPropagationEvent) => {
        event?.stopPropagation?.();
    }, []);
    const claimResponder = React.useCallback(() => true, []);
    const webStopPropagationProps = React.useMemo<WebStopPropagationProps>(() => ({
        onClick: stopEventPropagation,
        onMouseDown: stopEventPropagation,
        onPointerDown: stopEventPropagation,
    }), [stopEventPropagation]);
    const handleReplyKeyPress = React.useCallback((event: QuickReplyKeyPressEvent) => {
        event.stopPropagation?.();
        const keyEvent = normalizeKeyboardKeyPressEvent({
            key: event.nativeEvent?.key ?? '',
            code: event.nativeEvent?.code,
            shiftKey: event.nativeEvent?.shiftKey,
            altKey: event.nativeEvent?.altKey,
            ctrlKey: event.nativeEvent?.ctrlKey,
            metaKey: event.nativeEvent?.metaKey,
            repeat: event.nativeEvent?.repeat,
            isComposing: event.nativeEvent?.isComposing,
        });
        if (!keyEvent || keyEvent.key !== 'Enter' || keyEvent.shiftKey || keyEvent.isComposing) return;
        event.preventDefault?.();
        void handleSend();
    }, [handleSend]);
    React.useEffect(() => onInteractionLayoutChange?.(), [onInteractionLayoutChange, replyInputHeight]);

    return (
        <Pressable
            {...noDragProps}
            {...trayItemDragProps}
            testID={`desktop-pet-overlay-tray-item-${safeSessionId}`}
            data-pet-collapsed={active ? 'false' : 'true'}
            data-pet-reply-expanded={replyOpen ? 'true' : 'false'}
            accessibilityRole="button"
            accessibilityLabel={`${statusLabel}: ${props.item.title}`}
            onHoverIn={() => props.onActiveChange(props.item, true)}
            onHoverOut={() => props.onActiveChange(props.item, false)}
            onFocus={() => props.onActiveChange(props.item, true)}
            onBlur={() => props.onActiveChange(props.item, false)}
            onPress={() => {
                void props.onOpen(props.item);
            }}
            style={({ pressed }) => [
                styles.item,
                replyOpen ? styles.itemReplyOpen : null,
                {
                    background: pressed ? bubbleTheme.backgroundPressed : bubbleTheme.background,
                    backgroundColor: pressed ? bubbleTheme.backgroundPressed : bubbleTheme.background,
                },
            ]}
        >
            <View
                pointerEvents="none"
                testID={`desktop-pet-overlay-tray-surface-${safeSessionId}`}
                style={[
                    styles.itemSurface,
                    backgroundFillStyle,
                ]}
            />
            <View
                {...noDragProps}
                testID={`desktop-pet-overlay-tray-status-${safeSessionId}`}
                data-pet-status-icon={statusMark.kind === 'spinner' ? 'spinner' : statusMark.name}
                accessibilityLabel={statusLabel}
                style={styles.statusBadge}
            >
                {/* Keyed by the status, so a finished turn's spinner settles into its check where it stands. */}
                <StatusTransition
                    testID={`desktop-pet-overlay-tray-status-mark-${safeSessionId}`}
                    transitionKey={props.item.status}
                    size={STATUS_MARK_SIZE_PX}
                    fromScale={ICON_CIRCLE_INK_RATIO}
                >
                    {statusMark.kind === 'spinner' ? (
                        <ActivitySpinner
                            testID={`desktop-pet-overlay-tray-spinner-${safeSessionId}`}
                            size={iconMatchedSpinnerSize(STATUS_MARK_SIZE_PX)}
                            color={statusColor}
                            accessibilityLabel={statusLabel}
                            animationEnabled={props.animationEnabled}
                        />
                    ) : (
                        <Icon
                            testID={`desktop-pet-overlay-tray-status-glyph-${safeSessionId}`}
                            name={statusMark.name}
                            size={STATUS_MARK_SIZE_PX}
                            color={statusColor}
                        />
                    )}
                </StatusTransition>
            </View>
            <Pressable
                {...noDragProps}
                {...webStopPropagationProps}
                testID={`desktop-pet-overlay-tray-dismiss-${safeSessionId}`}
                pointerEvents={active ? 'auto' : 'none'}
                accessibilityRole="button"
                accessibilityLabel={t('settingsPets.overlayDismissAction')}
                onHoverIn={() => props.onActiveChange(props.item, true)}
                onHoverOut={() => props.onActiveChange(props.item, false)}
                onPressIn={stopEventPropagation}
                onStartShouldSetResponder={claimResponder}
                onPress={(event) => {
                    event?.stopPropagation?.();
                    if (replyOpen) {
                        setDraft('');
                        props.onReplyOpenChange(props.item, false);
                        return;
                    }
                    props.onDismiss(props.item);
                }}
                style={({ pressed }) => [
                    styles.iconButton,
                    I18nManager.isRTL ? styles.iconButtonRtl : null,
                    active ? styles.visibleAction : styles.hiddenAction,
                    { backgroundColor: pressed ? bubbleTheme.controlBackgroundPressed : bubbleTheme.controlBackground },
                ]}
            >
                <Icon name="x" size={14} color={bubbleTheme.textSecondary} />
            </Pressable>
            <View style={styles.copy}>
                <Text
                    numberOfLines={1}
                    style={[styles.title, { color: bubbleTheme.text, writingDirection }]}
                >
                    {props.item.title}
                </Text>
                {isReview || props.item.subtitle ? (
                    <View style={[styles.detailRow, I18nManager.isRTL ? styles.rowReverse : null]}>
                        {isReview ? (
                            // The session list's 「待查阅」 label: same words, same success pill.
                            <StatusPill
                                testID={`desktop-pet-overlay-tray-review-label-${safeSessionId}`}
                                variant="success"
                                label={t('status.readyForReview')}
                                hideDot={true}
                                labelNumberOfLines={1}
                                style={styles.reviewLabel}
                            />
                        ) : null}
                        {props.item.subtitle ? (
                            <Text
                                testID={`desktop-pet-overlay-tray-subtitle-${safeSessionId}`}
                                numberOfLines={replyOpen ? 2 : 1}
                                style={[
                                    styles.subtitle,
                                    styles.detailText,
                                    { color: bubbleTheme.textSecondary, writingDirection },
                                ]}
                            >
                                {props.item.subtitle}
                            </Text>
                        ) : null}
                    </View>
                ) : null}
            </View>
            <Pressable
                {...noDragProps}
                {...webStopPropagationProps}
                testID={`desktop-pet-overlay-tray-reply-action-${safeSessionId}`}
                pointerEvents={active && !replyOpen ? 'auto' : 'none'}
                accessibilityRole="button"
                accessibilityLabel={t('settingsPets.overlayReplyAction')}
                onHoverIn={() => props.onActiveChange(props.item, true)}
                onHoverOut={() => props.onActiveChange(props.item, false)}
                onPressIn={stopEventPropagation}
                onStartShouldSetResponder={claimResponder}
                onPress={(event) => {
                    event?.stopPropagation?.();
                    props.onReplyOpenChange(props.item, true);
                }}
                style={({ pressed }) => [
                    styles.replyAction,
                    active && !replyOpen ? styles.visibleAction : styles.hiddenAction,
                    { backgroundColor: pressed ? bubbleTheme.controlBackgroundPressed : bubbleTheme.controlBackground },
                ]}
            >
                <Text
                    disableUiFontScaling={true}
                    style={[styles.replyActionText, { color: bubbleTheme.text }]}
                >
                    {t('settingsPets.overlayReplyAction')}
                </Text>
            </Pressable>
            <View
                {...noDragProps}
                testID={`desktop-pet-overlay-tray-reply-row-${safeSessionId}`}
                accessibilityElementsHidden={!replyOpen}
                importantForAccessibility={replyOpen ? 'auto' : 'no-hide-descendants'}
                style={[
                    styles.replyRow,
                    replyOpen ? styles.replyRowExpanded : styles.replyRowCollapsed,
                    I18nManager.isRTL ? styles.rowReverse : null,
                    replyOpen ? { maxHeight: replyInputHeight } : null,
                ]}
            >
                {replyOpen ? (
                    <Pressable
                        {...noDragProps}
                        {...webStopPropagationProps}
                        testID={`desktop-pet-overlay-tray-reply-input-shell-${safeSessionId}`}
                        onPress={stopEventPropagation}
                        onPressIn={stopEventPropagation}
                        onStartShouldSetResponder={() => true}
                        style={[
                            styles.replyInputShell,
                            {
                                height: replyInputHeight,
                                minHeight: replyInputHeight,
                                maxHeight: replyInputHeight,
                            },
                        ]}
                    >
                        <TextInput
                            {...noDragProps}
                            {...webStopPropagationProps}
                            testID={`desktop-pet-overlay-tray-reply-input-${safeSessionId}`}
                            accessibilityLabel={t('settingsPets.overlayQuickReplyPlaceholder')}
                            placeholder={t('settingsPets.overlayQuickReplyPlaceholder')}
                            multiline={true}
                            numberOfLines={replyInputNumberOfLines}
                            blurOnSubmit={false}
                            value={draft}
                            onChangeText={setDraft}
                            onKeyPress={handleReplyKeyPress}
                            onPress={stopEventPropagation}
                            onPressIn={stopEventPropagation}
                            onSubmitEditing={(event) => {
                                stopEventPropagation(event);
                                void handleSend();
                            }}
                            returnKeyType="send"
                            style={[
                                styles.replyInput,
                                I18nManager.isRTL ? styles.replyInputRtl : null,
                                webReplyInputControlStyle,
                                {
                                    backgroundColor: bubbleTheme.controlBackground,
                                    color: bubbleTheme.text,
                                    borderColor: bubbleTheme.controlBackgroundPressed,
                                    height: replyInputHeight,
                                    minHeight: replyInputHeight,
                                    maxHeight: replyInputHeight,
                                    overflowY: replyInputOverflowY,
                                    writingDirection,
                                } as unknown as TextStyle,
                            ]}
                            placeholderTextColor={bubbleTheme.textSecondary}
                        />
                        <Pressable
                            {...noDragProps}
                            {...webStopPropagationProps}
                            testID={`desktop-pet-overlay-tray-reply-send-${safeSessionId}`}
                            accessibilityRole="button"
                            accessibilityLabel={t('settingsPets.overlayQuickReplyAction')}
                            disabled={!draft.trim()}
                            onPressIn={stopEventPropagation}
                            onStartShouldSetResponder={claimResponder}
                            onPress={(event) => {
                                event?.stopPropagation?.();
                                void handleSend();
                            }}
                            style={({ pressed }) => [
                                styles.sendButton,
                                I18nManager.isRTL ? styles.sendButtonRtl : null,
                                {
                                    backgroundColor: draft.trim()
                                        ? primaryButtonTheme.background
                                        : primaryButtonTheme.disabled,
                                    opacity: pressed ? 0.72 : 1,
                                },
                            ]}
                        >
                            <Icon
                                name="arrow-up"
                                size={14}
                                color={primaryButtonTheme.tint}
                            />
                        </Pressable>
                    </Pressable>
                ) : null}
            </View>
        </Pressable>
    );
}

export function PetCompanionActivityTray(props: PetCompanionActivityTrayProps): React.ReactElement | null {
    const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
    const [replySessionId, setReplySessionId] = React.useState<string | null>(null);
    const deactivateTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const { onInteractionLayoutChange } = props;
    const clearDeactivateTimer = React.useCallback(() => {
        if (deactivateTimerRef.current === null) return;
        clearTimeout(deactivateTimerRef.current);
        deactivateTimerRef.current = null;
    }, []);
    const handleActiveChange = React.useCallback((item: PetCompanionTrayItem, active: boolean) => {
        if (active) {
            clearDeactivateTimer();
            setActiveSessionId(item.sessionId);
            return;
        }
        clearDeactivateTimer();
        deactivateTimerRef.current = setTimeout(() => {
            setActiveSessionId((current) => (current === item.sessionId ? null : current));
            deactivateTimerRef.current = null;
        }, 120);
    }, [clearDeactivateTimer]);
    const handleReplyOpenChange = React.useCallback((item: PetCompanionTrayItem, open: boolean) => {
        clearDeactivateTimer();
        onInteractionLayoutChange?.();
        setReplySessionId(open ? item.sessionId : null);
        if (open) {
            setActiveSessionId(item.sessionId);
        }
    }, [clearDeactivateTimer, onInteractionLayoutChange]);
    const scrollFades = useScrollEdgeFades({
        enabledEdges: { top: true, bottom: true },
        overflowThreshold: 2,
        edgeThreshold: 2,
    });
    const scrollMaskStyle = React.useMemo(
        () => resolveVerticalScrollEdgeMaskStyle(scrollFades.visibility, { fadeSize: 14 }),
        [scrollFades.visibility],
    );
    React.useEffect(() => clearDeactivateTimer, [clearDeactivateTimer]);
    if (props.items.length === 0) return null;

    return (
        <View
            {...noDragProps}
            testID="desktop-pet-overlay-tray"
            data-pet-tray-open={props.open ? 'true' : 'false'}
            data-pet-scroll-fade-top={scrollFades.visibility.top ? 'true' : 'false'}
            data-pet-scroll-fade-bottom={scrollFades.visibility.bottom ? 'true' : 'false'}
            pointerEvents={props.open ? 'auto' : 'none'}
            accessibilityElementsHidden={!props.open}
            importantForAccessibility={props.open ? 'auto' : 'no-hide-descendants'}
            accessibilityLiveRegion="polite"
            accessibilityLabel={t('settingsPets.overlayTrayTitle')}
            style={[
                styles.root,
                props.style,
                props.open ? styles.rootOpen : styles.rootCollapsed,
            ]}
        >
            <ScrollView
                {...noDragProps}
                testID="desktop-pet-overlay-tray-scroll"
                style={[styles.scroll, scrollMaskStyle]}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onLayout={scrollFades.onViewportLayout}
                onContentSizeChange={scrollFades.onContentSizeChange}
                onScroll={scrollFades.onScroll}
                onMomentumScrollEnd={scrollFades.onMomentumScrollEnd}
            >
                {props.items.map((item) => (
                    <PetCompanionActivityTrayItemCard
                        key={item.sessionId}
                        item={item}
                        active={activeSessionId === item.sessionId || props.externalActiveSessionId === item.sessionId}
                        replyOpen={replySessionId === item.sessionId}
                        animationEnabled={props.open}
                        onActiveChange={handleActiveChange}
                        onReplyOpenChange={handleReplyOpenChange}
                        onInteractionLayoutChange={props.onInteractionLayoutChange}
                        onOpen={props.onOpenItem}
                        onDismiss={props.onDismissItem}
                        onQuickReply={props.onQuickReply}
                    />
                ))}
            </ScrollView>
        </View>
    );
}
