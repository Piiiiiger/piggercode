import * as React from 'react';
import { Animated, Platform, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { useIsHostVisible } from '@/hooks/ui/useIsHostVisible';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

const WEB_PULSE_TIMING_FUNCTION = 'steps(6, end)';

export interface StatusDotProps {
    color: string;
    isPulsing?: boolean;
    size?: number;
    style?: ViewStyle;
    testID?: string;
    /** Keep pulsing state visible while disabling its animation. */
    animationEnabled?: boolean;
    /** Draw this character in `color` instead of a filled dot (the composer's working mark). */
    glyph?: string;
}

export const StatusDot = React.memo((props: StatusDotProps) => {
    if (Platform.OS === 'web') {
        return <WebStatusDot {...props} />;
    }
    if (props.isPulsing) {
        return <PulsingStatusDot {...props} />;
    }
    return <StaticStatusDot {...props} />;
});

function resolveBaseDotStyle(color: string, size: number, glyph?: string): ViewStyle {
    if (glyph) return { alignItems: 'center', justifyContent: 'center' };
    return {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
    };
}

function DotGlyph({ glyph, color, size }: { glyph?: string; color: string; size: number }) {
    if (!glyph) return null;
    return <Text style={{ color, fontSize: size, lineHeight: Math.round(size * 1.2) }}>{glyph}</Text>;
}

function WebStatusDot({ color, isPulsing, size = 6, style, testID, animationEnabled = true, glyph }: StatusDotProps) {
    const hostVisible = useIsHostVisible();
    const reducedMotion = useReducedMotionPreference();
    return (
        <View
            testID={testID}
            style={[
                resolveBaseDotStyle(color, size, glyph),
                isPulsing && animationEnabled && hostVisible && !reducedMotion ? webPulseStyle : null,
                style,
            ]}
        >
            <DotGlyph glyph={glyph} color={color} size={size} />
        </View>
    );
}

/**
 * Non-pulsing native dot. Renders a plain `View` with no Reanimated hooks so an idle dot does not
 * register an animated node with the native Reanimated registry. Hooks live only in
 * `PulsingStatusDot`, which the parent mounts behind a stable `isPulsing` boundary, keeping the
 * Rules of Hooks intact (each subcomponent has a fixed hook order).
 */
function StaticStatusDot({ color, size = 6, style, testID, glyph }: StatusDotProps) {
    return (
        <View
            testID={testID}
            style={[
                resolveBaseDotStyle(color, size, glyph),
                style,
            ]}
        >
            <DotGlyph glyph={glyph} color={color} size={size} />
        </View>
    );
}

function PulsingStatusDot({ color, size = 6, style, testID, animationEnabled = true, glyph }: StatusDotProps) {
    const hostVisible = useIsHostVisible();
    const reducedMotion = useReducedMotionPreference();
    const shouldAnimate = animationEnabled && hostVisible && !reducedMotion;
    const opacity = React.useRef(new Animated.Value(1)).current;

    React.useEffect(() => {
        if (!shouldAnimate) {
            opacity.setValue(1);
            return;
        }
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    duration: 1000,
                    toValue: 0.3,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    duration: 1000,
                    toValue: 1,
                    useNativeDriver: true,
                }),
            ]),
        );
        animation.start();
        return () => {
            animation.stop();
        };
    }, [opacity, shouldAnimate]);

    return (
        <Animated.View
            testID={testID}
            style={[
                resolveBaseDotStyle(color, size, glyph),
                { opacity },
                style,
            ]}
        >
            <DotGlyph glyph={glyph} color={color} size={size} />
        </Animated.View>
    );
}

type WebPulseStyle = ViewStyle & {
    animationDirection?: 'alternate';
    animationDuration?: string;
    animationIterationCount?: string;
    animationName?: string;
    animationTimingFunction?: string;
};

const webPulseStyle: WebPulseStyle = {
    animationDirection: 'alternate',
    animationDuration: '1000ms',
    animationIterationCount: 'infinite',
    animationName: 'happierStatusDotPulse',
    animationTimingFunction: WEB_PULSE_TIMING_FUNCTION,
};
