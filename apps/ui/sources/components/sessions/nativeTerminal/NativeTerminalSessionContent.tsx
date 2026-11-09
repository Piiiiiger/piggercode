import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { resolveAgentIdFromSessionMetadata } from '@piggercode/agents';

import { getAgentCore } from '@/agents/catalog/catalog';
import type { EmbeddedTerminalRendererHandle } from '@/components/sessions/terminal/embeddedTerminalRendererHandle';
import { useSessionEmbeddedTerminalPty } from '@/components/sessions/terminal/useSessionEmbeddedTerminalPty';
import { EmbeddedTerminalPane } from '@/components/terminal/embedded/EmbeddedTerminalPane';
import { EmbeddedTerminalToolbarIconButton } from '@/components/terminal/embedded/EmbeddedTerminalToolbarIconButton';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { getStorage } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { reopenSessionAsTerminal } from './openSessionAsTerminal';

type NativeTerminalSessionContentProps = Readonly<{
    sessionId: string;
    serverId: string | null;
}>;

/**
 * The whole view of a 「终端」 session: the CLI's own terminal (Claude Code or Codex), attached
 * through the machine (`piggercode attach`). There is no transcript or composer; the user types
 * into the CLI.
 */
export const NativeTerminalSessionContent = React.memo(function NativeTerminalSessionContent(props: NativeTerminalSessionContentProps) {
    const state = getStorage()((storeState): 'running' | 'starting' | 'ended' => {
        const session = storeState.sessions[props.sessionId];
        if (session?.active === true) return 'running';
        // A start (new or reopened) the machine accepted, until its runner comes online.
        return session?.resumingAt != null ? 'starting' : 'ended';
    });
    const agentName = getStorage()((storeState) => {
        const agentId = resolveAgentIdFromSessionMetadata(storeState.sessions[props.sessionId]?.metadata);
        return agentId ? t(getAgentCore(agentId).displayNameKey) : 'CLI';
    });
    if (state === 'running') return <NativeTerminalSessionPane sessionId={props.sessionId} agentName={agentName} />;
    if (state === 'starting') return <NativeTerminalSessionStarting agentName={agentName} />;
    return <NativeTerminalSessionEnded sessionId={props.sessionId} serverId={props.serverId} />;
});

const NativeTerminalSessionStarting = React.memo(function NativeTerminalSessionStarting(props: Readonly<{ agentName: string }>) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.ended} testID="session-native-terminal-starting">
            <ActivitySpinner size="small" color={theme.colors.text.secondary} />
            <Text style={styles.endedBody}>{t('sessionNativeTerminal.starting', { agent: props.agentName })}</Text>
        </View>
    );
});

const NativeTerminalSessionPane = React.memo(function NativeTerminalSessionPane(props: Readonly<{ sessionId: string; agentName: string }>) {
    const terminalRef = React.useRef<EmbeddedTerminalRendererHandle | null>(null);
    const controller = useSessionEmbeddedTerminalPty({
        sessionId: props.sessionId,
        terminalKey: `session-attach:${props.sessionId}`,
        terminalMode: 'session_attach',
        terminalRef,
    });
    const { agentName } = props;
    const explain = React.useCallback(() => {
        Modal.alert(t('sessionNativeTerminal.aboutTitle'), t('sessionNativeTerminal.aboutBody', { agent: agentName }));
    }, [agentName]);

    return (
        <View style={styles.fill}>
            <EmbeddedTerminalPane
                title={t('sessionNativeTerminal.title', { agent: agentName })}
                controller={controller}
                terminalRef={terminalRef}
                testIdPrefix="session-native-terminal"
                toolbarActionsStart={(
                    <EmbeddedTerminalToolbarIconButton
                        icon="info"
                        testID="session-native-terminal-about"
                        accessibilityLabel={t('sessionNativeTerminal.aboutTitle')}
                        onPress={explain}
                    />
                )}
            />
        </View>
    );
});

const NativeTerminalSessionEnded = React.memo(function NativeTerminalSessionEnded(props: NativeTerminalSessionContentProps) {
    const [reopening, setReopening] = React.useState(false);
    const reopen = React.useCallback(async () => {
        setReopening(true);
        try {
            await reopenSessionAsTerminal({ sessionId: props.sessionId, serverId: props.serverId });
        } finally {
            setReopening(false);
        }
    }, [props.serverId, props.sessionId]);

    return (
        <View style={styles.ended} testID="session-native-terminal-ended">
            <Text style={styles.endedTitle}>{t('sessionNativeTerminal.endedTitle')}</Text>
            <Text style={styles.endedBody}>{t('sessionNativeTerminal.endedBody')}</Text>
            <RoundButton
                size="normal"
                title={t('sessionNativeTerminal.reopen')}
                action={reopen}
                loading={reopening}
                testID="session-native-terminal-reopen"
            />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    fill: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
    ended: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        paddingHorizontal: 24,
    },
    endedTitle: {
        fontSize: 17,
        color: theme.colors.text.primary,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    endedBody: {
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        maxWidth: 420,
        ...Typography.default(),
    },
}));
