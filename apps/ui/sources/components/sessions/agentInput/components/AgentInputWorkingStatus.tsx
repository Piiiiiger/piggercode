import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { Text } from '@/components/ui/text/Text';
import { formatWorkingElapsed, useRunningTurnServerClock } from '@/components/sessions/workState/runningTurnClock';
import { useSessionTurnOutputTokens } from '@/sync/domains/state/storage';

// Claude Code's working mark, in the theme's active accent (the Claude orange in the Claude Code
// profiles). It pulses through the shared status-dot animation, which stops while the window is
// hidden and under reduced motion.
const WORKING_GLYPH = '✻';
const WORKING_GLYPH_SIZE = 13;

export function formatWorkingTokens(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    const thousands = tokens / 1000;
    return `${thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, '') : Math.round(thousands)}k`;
}

/**
 * The composer's "working" line, the way Claude Code shows it: a pulsing mark, the verb, the time
 * the turn has run and the tokens it has generated so far. Only this line re-renders as it ticks.
 */
export const AgentInputWorkingStatus = React.memo(function AgentInputWorkingStatus(props: Readonly<{
    sessionId: string;
    /** Server time the running turn started; null while it is not known yet. */
    startedAt: number | null;
    text: string;
    color: string;
    testID?: string;
}>) {
    const { theme } = useUnistyles();
    const outputTokens = useSessionTurnOutputTokens(props.sessionId, props.startedAt);
    const now = useRunningTurnServerClock(props.startedAt);

    const verb = props.text.length > 0 ? props.text.charAt(0).toUpperCase() + props.text.slice(1) : props.text;
    const details: string[] = [];
    if (props.startedAt !== null) details.push(formatWorkingElapsed(now - props.startedAt));
    if (outputTokens !== null) details.push(`↓ ${formatWorkingTokens(outputTokens)} tokens`);

    return (
        <View style={styles.row} testID={props.testID}>
            <StatusDot
                glyph={WORKING_GLYPH}
                size={WORKING_GLYPH_SIZE}
                color={theme.colors.state.active.foreground}
                isPulsing
                style={styles.glyph}
            />
            <Text style={[styles.text, { color: props.color }]} numberOfLines={1}>
                {verb}
                {details.length > 0 ? (
                    <Text style={styles.details}>{` (${details.join(' · ')})`}</Text>
                ) : null}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
    },
    glyph: {
        width: 14,
        marginRight: 4,
    },
    text: {
        flexShrink: 1,
        fontSize: 11,
        ...Typography.default(),
    },
    details: {
        color: theme.colors.text.secondary,
        ...Typography.tabular(),
    },
}));
