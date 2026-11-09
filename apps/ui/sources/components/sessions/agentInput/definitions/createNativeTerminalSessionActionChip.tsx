import * as React from 'react';
import { Pressable } from 'react-native';

import type { AgentInputExtraActionChip } from '@/components/sessions/agentInput/agentInputContracts';
import { Icon } from '@/components/ui/icons/Icon';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { AGENT_INPUT_CHIP_ICON_SIZE_PX, AGENT_INPUT_CHIP_ICON_STYLE } from './agentInputChipIconMetrics';

/** Starts a 「终端」 session (native Claude Code in a terminal) in the chosen folder at once. */
export function createNativeTerminalSessionActionChip(params: Readonly<{ onPress: () => void }>): AgentInputExtraActionChip {
    const key = 'new-session-native-terminal';
    return {
        key,
        collapsedAction: ({ dismiss }) => ({
            id: key,
            label: t('newSession.nativeTerminalChip.label'),
            icon: null,
            onPress: () => {
                dismiss();
                params.onPress();
            },
        }),
        render: ({ chipStyle, iconColor, showLabel, textStyle }) => (
            <Pressable
                testID="agent-input-native-terminal-chip"
                onPress={params.onPress}
                hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                style={(pressableState) => chipStyle(pressableState.pressed)}
                accessibilityRole="button"
                accessibilityLabel={t('newSession.nativeTerminalChip.a11y')}
            >
                {normalizeNodeForView(
                    <Icon name="terminal" size={AGENT_INPUT_CHIP_ICON_SIZE_PX} color={iconColor} style={AGENT_INPUT_CHIP_ICON_STYLE} />,
                )}
                {showLabel ? (
                    <Text numberOfLines={1} style={textStyle}>
                        {t('newSession.nativeTerminalChip.label')}
                    </Text>
                ) : null}
            </Pressable>
        ),
    };
}
