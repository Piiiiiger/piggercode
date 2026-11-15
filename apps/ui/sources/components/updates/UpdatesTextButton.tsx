import * as React from 'react';
import { Platform, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

/**
 * The Updates surface's quiet text action ("Check for updates", "Stop after this one", "View log"):
 * the inbox's mark-all-read label style, with the platform hit slop. `busy`: what it started is still
 * running — the app's spinner shows before the label and the action waits.
 */
export const UpdatesTextButton = React.memo(function UpdatesTextButton(props: Readonly<{
    label: string;
    onPress: () => void;
    testID: string;
    accessibilityLabel?: string;
    busy?: boolean;
}>) {
    const { theme } = useUnistyles();
    const busy = props.busy === true;
    return (
        <Pressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel ?? props.label}
            accessibilityState={busy ? { busy: true } : undefined}
            disabled={busy}
            hitSlop={Platform.select({ ios: 15, default: 17 })}
            onPress={props.onPress}
            style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
        >
            {busy ? (
                <ActivitySpinner testID={`${props.testID}:busy`} size={BUSY_SPINNER_SIZE} color={theme.colors.text.secondary} />
            ) : null}
            <Text style={styles.label}>{props.label}</Text>
        </Pressable>
    );
});

/** The label's line height, so the spinner sits on the label's line without moving it. */
const BUSY_SPINNER_SIZE = 14;

const styles = StyleSheet.create((theme) => ({
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    pressed: {
        opacity: 0.6,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        lineHeight: 14,
        color: theme.colors.text.secondary,
    },
}));
