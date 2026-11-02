import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { PIGGERCODE_CLOUD_SERVER_URL } from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { derivePresentableRelayHost } from '@/sync/domains/server/url/serverUrlDisplay';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';


const PIGGERCODE_CLOUD_COMPARABLE_KEY = createServerUrlComparableKey(PIGGERCODE_CLOUD_SERVER_URL);

export type WelcomeFooterLinksProps = Readonly<{
    variant: 'desktop' | 'mobile';
    retentionSummary?: string | null;
    onOpenRelayCustomFlow: () => void;
}>;

/**
 * Welcome-step-only footer rendered at the bottom of the workflow pane.
 * Two stacked groups (each: label on one line, action on the next line):
 *
 *   Self-hosting?               Need help?
 *   Use your own Relay          Docs · GH · Discord
 *
 * Desktop arranges the two groups side-by-side with space-between. Mobile
 * stacks them centred. The `Docs` action is followed by GitHub and Discord
 * brand icons that link to the public repo and the community Discord.
 */
export const WelcomeFooterLinks = React.memo(function WelcomeFooterLinks(props: WelcomeFooterLinksProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;


    const labelColor = { color: theme.colors.text.secondary };
    const actionColor = { color: theme.colors.text.primary };
    const actionPressedStyle = { opacity: 0.7 };
    const iconColor = theme.colors.text.primary;
    const isMobile = props.variant === 'mobile';
    const relayGroupStyle = isMobile ? styles.groupMobile : styles.groupDesktop;

    // The user has actively chosen a non-cloud relay when the active server's
    // canonicalised URL doesn't match the Happier Cloud key. While we have no
    // server URL yet (cold start), default to the cloud framing so the footer
    // doesn't flicker into the custom layout for a single render.
    const activeServer = useActiveServerSnapshot();
    const isCustomRelay = activeServer.serverUrl.length > 0
        && createServerUrlComparableKey(activeServer.serverUrl) !== PIGGERCODE_CLOUD_COMPARABLE_KEY;
    const customRelayHost = isCustomRelay
        ? (derivePresentableRelayHost(activeServer.serverUrl) ?? activeServer.serverUrl)
        : null;

    return (
        <View
            style={isMobile ? styles.containerMobile : styles.containerDesktop}
            testID="welcome-footer-links"
        >
            {props.retentionSummary ? (
                <View
                    testID="welcome-footer-retention"
                    accessibilityRole="text"
                    style={styles.retentionRow}
                >
                    <Icon
                        testID="welcome-footer-retention-icon"
                        name="clock-counter-clockwise"
                        size={14}
                        color={labelColor.color}
                        style={styles.retentionIcon}
                    />
                    <Text style={[styles.label, labelColor, styles.retentionText]}>
                        {props.retentionSummary}
                    </Text>
                </View>
            ) : null}
            <View style={isMobile ? styles.linksMobile : styles.linksDesktop}>
                <View style={relayGroupStyle} testID="welcome-footer-relay">
                    <Text style={[styles.label, labelColor]}>
                        {isCustomRelay ? t('welcome.welcomeFooterRelayActiveLabel') : t('welcome.welcomeFooterRelay')}
                    </Text>
                    <Pressable
                        onPress={props.onOpenRelayCustomFlow}
                        accessibilityRole="link"
                        accessibilityLabel={isCustomRelay ? t('welcome.welcomeFooterRelayEditAccessibility') : undefined}
                        testID="welcome-footer-relay-action"
                    >
                        {({ pressed }) => (
                            isCustomRelay && customRelayHost ? (
                                <View style={isMobile ? styles.relayHostRowMobile : styles.relayHostRowDesktop}>
                                    <Text
                                        style={[styles.actionBold, actionColor, styles.relayHostText, pressed ? actionPressedStyle : null]}
                                        numberOfLines={1}
                                        ellipsizeMode="tail"
                                        testID="welcome-footer-relay-host"
                                    >
                                        {customRelayHost}
                                    </Text>
                                    <Icon
                                        name="pencil"
                                        size={14}
                                        color={iconColor}
                                        style={pressed ? actionPressedStyle : undefined}
                                    />
                                </View>
                            ) : (
                                <Text style={[styles.actionBold, actionColor, pressed ? actionPressedStyle : null]}>
                                    {t('welcome.welcomeFooterRelayAction')}
                                </Text>
                            )
                        )}
                    </Pressable>
                </View>
            </View>
        </View>
    );
});

const stylesheet = StyleSheet.create(() => ({
    containerDesktop: {
        width: '100%',
        flexDirection: 'column',
        alignItems: 'stretch',
        paddingTop: 20,
        paddingBottom: 28,
        gap: 14,
    },
    containerMobile: {
        width: '100%',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 14,
        paddingTop: 18,
    },
    linksDesktop: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 24,
    },
    linksMobile: {
        width: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
    },
    retentionRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
    },
    retentionText: {
        flex: 1,
        minWidth: 0,
    },
    retentionIcon: {
        marginTop: 2,
    },
    groupDesktop: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
    },
    groupMobile: {
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
    },
    label: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
    },
    actionBold: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        lineHeight: 18,
        textDecorationLine: 'underline',
    },
    relayHostRowDesktop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        // Cap the host chip so a long hostname can't push the pencil icon
        // off the right edge or collide with the right-side Docs group.
        // Ellipsis truncation handles anything past this width.
        maxWidth: 260,
    },
    relayHostRowMobile: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        maxWidth: 280,
    },
    relayHostText: {
        // Let the Text shrink/ellipsize within the row instead of pushing the
        // pencil icon out. flexShrink:1 + minWidth:0 is the canonical recipe
        // for tail-ellipsis-inside-a-row on RN web.
        flexShrink: 1,
        minWidth: 0,
    },
}));
