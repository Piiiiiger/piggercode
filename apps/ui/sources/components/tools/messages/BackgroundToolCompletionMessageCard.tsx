import React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { BackgroundToolCompletionV1 } from '@piggercode/protocol';
import { resolveToolHeaderTextPresentation } from '@/components/tools/shell/presentation/resolveToolHeaderTextPresentation';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

/** The tool's name as its call reads in the transcript ("Remote command", "MCP: …"). */
function readToolTitle(payload: BackgroundToolCompletionV1): string {
    return resolveToolHeaderTextPresentation({
        tool: {
            id: payload.callId,
            name: payload.toolName,
            state: payload.status === 'failed' ? 'error' : 'completed',
            input: {},
            createdAt: payload.finishedAtMs,
            startedAt: null,
            completedAt: payload.finishedAtMs,
            description: null,
        },
        metadata: null,
    }).title;
}

/**
 * The session's automated notice that a tool call finished after the agent's turn ended (see
 * `buildBackgroundToolCompletionInputV1`). It replaces the generated user message with one quiet line.
 */
export function BackgroundToolCompletionMessageCard(props: Readonly<{ payload: BackgroundToolCompletionV1 }>) {
    const { theme } = useUnistyles();
    const failed = props.payload.status === 'failed';
    const tool = readToolTitle(props.payload);
    const text = failed
        ? t('tools.backgroundCompletion.failed', { tool })
        : t('tools.backgroundCompletion.finished', { tool });

    return (
        <View
            testID={`background-tool-completion:${props.payload.callId}`}
            accessible
            accessibilityRole="text"
            accessibilityLabel={text}
            style={styles.row}
        >
            <Icon
                name={failed ? 'warning-circle' : 'check-circle'}
                size={14}
                color={failed ? theme.colors.state.danger.foreground : theme.colors.state.success.foreground}
            />
            <Text selectable style={styles.text}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 4,
    },
    text: {
        flexShrink: 1,
        color: theme.colors.text.secondary,
        fontSize: 13,
    },
}));
