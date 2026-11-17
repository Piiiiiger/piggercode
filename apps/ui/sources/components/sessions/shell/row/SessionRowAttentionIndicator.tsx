import React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { StatusDot } from '@/components/ui/status/StatusDot';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import type {
    SessionRowAttentionIndicator as SessionRowAttentionIndicatorKind,
    SessionRowAttentionState,
} from './resolveSessionRowPresentation';
import { resolveSessionRowAttentionIndicatorColor } from './sessionRowAttentionColors';

/** Fills the indicator's 16 px slot, so the working mark reads at the scale of the row's agent icons. */
const DEFAULT_WORKING_SPINNER_SIZE = 16;
const UNREAD_CENTER_SIZE = 3;

/**
 * The states a row can say in words, in the same hue its dot has (`sessionRowAttentionColors`). A finished turn
 * the user has looked at (「已查阅」) is plain neutral text: it recedes where one still to review (「待查阅」) stands
 * out, and most quiet rows carry it, so it does not add a tinted badge to each of them.
 */
const LABELLED_INDICATORS: Partial<Record<SessionRowAttentionIndicatorKind, Readonly<{ variant: StatusPillVariant; chrome?: 'plain' }>>> = {
    ready: { variant: 'success' },
    reviewed: { variant: 'neutral', chrome: 'plain' },
    permission: { variant: 'warning' },
    action: { variant: 'warning' },
    failed: { variant: 'danger' },
};

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    unreadCenter: {
        position: 'absolute',
        left: (DEFAULT_WORKING_SPINNER_SIZE - UNREAD_CENTER_SIZE) / 2,
        top: (DEFAULT_WORKING_SPINNER_SIZE - UNREAD_CENTER_SIZE) / 2,
        width: UNREAD_CENTER_SIZE,
        height: UNREAD_CENTER_SIZE,
        borderRadius: UNREAD_CENTER_SIZE / 2,
        backgroundColor: theme.colors.text.link,
    },
    stateContainer: {
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // A labelled state gives way to the row's title: the pill shrinks and its label truncates.
    labelled: {
        flexShrink: 1,
        minWidth: 0,
    },
}));

export const SessionRowAttentionIndicator = React.memo(function SessionRowAttentionIndicator(props: Readonly<{
    indicator: SessionRowAttentionIndicatorKind;
    sessionId: string;
    attentionState: SessionRowAttentionState;
    accessibilityLabel?: string;
    /**
     * The state in words. Given, a finished turn, a request waiting for the user or a failure shows as a
     * labelled pill instead of the bare dot, so it reads at a glance and not by color alone.
     */
    label?: string;
    hasUnreadMessages?: boolean;
    workingMode?: 'spinner' | 'pulse';
    workingSpinnerTone?: 'info' | 'neutral';
    animationEnabled?: boolean;
}>) {
    const { theme } = useUnistyles();

    if (props.indicator === 'none') {
        return null;
    }

    const color = resolveSessionRowAttentionIndicatorColor({
        indicator: props.indicator,
        theme,
        workingMode: props.workingMode,
        workingSpinnerTone: props.workingSpinnerTone,
    });

    const shouldRenderWorkingSpinner = props.indicator === 'working'
        && props.workingMode !== 'pulse';
    const shouldPulse = props.indicator === 'permission'
        || props.indicator === 'action'
        || props.indicator === 'failed'
        || (props.indicator === 'working' && props.workingMode === 'pulse');
    const labelled = props.label ? LABELLED_INDICATORS[props.indicator] : undefined;

    if (labelled && props.label) {
        return (
            <View
                testID={`session-row-attention-indicator-${props.sessionId}`}
                accessibilityLabel={props.accessibilityLabel ?? props.label}
                accessibilityRole="image"
                style={stylesheet.labelled}
            >
                <View
                    testID={`session-list-attention-indicator-${props.sessionId}-${props.attentionState}`}
                    style={stylesheet.labelled}
                >
                    <StatusPill
                        testID={`session-row-attention-indicator-label-${props.sessionId}`}
                        variant={labelled.variant}
                        chrome={labelled.chrome}
                        label={props.label}
                        labelNumberOfLines={1}
                        style={stylesheet.labelled}
                        // The row's own animation gate (hidden, off screen, inactive list) holds the pulse too.
                        isPulsing={shouldPulse && props.animationEnabled !== false}
                    />
                </View>
            </View>
        );
    }

    return (
        <View
            testID={`session-row-attention-indicator-${props.sessionId}`}
            accessibilityLabel={props.accessibilityLabel}
            accessibilityRole={props.accessibilityLabel ? 'image' : undefined}
            style={stylesheet.container}
        >
            <View
                testID={`session-list-attention-indicator-${props.sessionId}-${props.attentionState}`}
                style={stylesheet.stateContainer}
            >
                {shouldRenderWorkingSpinner ? (
                    <ActivitySpinner
                        testID={`session-row-attention-indicator-spinner-${props.sessionId}`}
                        size={DEFAULT_WORKING_SPINNER_SIZE}
                        color={color}
                        animationEnabled={props.animationEnabled !== false}
                    />
                ) : (
                    <StatusDot
                        testID={`session-row-attention-indicator-dot-${props.sessionId}`}
                        color={color}
                        isPulsing={shouldPulse}
                        size={props.indicator === 'permission' || props.indicator === 'action' || props.indicator === 'failed' ? 7 : 6}
                        animationEnabled={props.animationEnabled !== false}
                    />
                )}
                {props.indicator === 'working' && props.hasUnreadMessages && (
                    <View
                        testID={`session-row-unread-center-${props.sessionId}`}
                        pointerEvents="none"
                        accessible={false}
                        style={stylesheet.unreadCenter}
                    />
                )}
            </View>
        </View>
    );
});
