import * as React from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { formatWorkingElapsed, useRunningTurnServerClock } from '@/components/sessions/workState/runningTurnClock';

/** A row's running time (`2m 54s`), ticking once a second; only this text re-renders as it ticks. */
export const RunningTurnElapsed = React.memo(function RunningTurnElapsed(props: Readonly<{
    startedAt: number;
    style?: StyleProp<TextStyle>;
}>) {
    const now = useRunningTurnServerClock(props.startedAt);
    return (
        <Text style={props.style} numberOfLines={1}>
            {formatWorkingElapsed(now - props.startedAt)}
        </Text>
    );
});
