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

import { reopenSessionAsTerminal, switchChatSessionToTerminal } from './openSessionAsTerminal';

type NativeTerminalSessionContentProps = Readonly<{
    sessionId: string;
    serverId: string | null;
}>;

/**
 * The whole view of every session: the CLI's own terminal (Claude Code or Codex), attached
 * through the machine (`piggercode attach`). There is no transcript or composer; the user types
 * into the CLI.
 */
export const NativeTerminalSessionContent = React.memo(function NativeTerminalSessionContent(props: NativeTerminalSessionContentProps) {
    const state = getStorage()((storeState): 'running' | 'chat' | 'starting' | 'ended' => {
        const session = storeState.sessions[props.sessionId];
        // A chat started before every session became a terminal has no terminal to attach to.
        if (session?.active === true) return session.metadata?.nativeTerminal === true ? 'running' : 'chat';
        // A start (new or reopened) the machine accepted, until its runner comes online.
        return session?.resumingAt != null ? 'starting' : 'ended';
    });
    const agentName = getStorage()((storeState) => {
        const agentId = resolveAgentIdFromSessionMetadata(storeState.sessions[props.sessionId]?.metadata);
        return agentId ? t(getAgentCore(agentId).displayNameKey) : 'CLI';
    });
    if (state === 'running') return <NativeTerminalSessionPane sessionId={props.sessionId} agentName={agentName} />;
    if (state === 'chat') return <NativeTerminalSessionChatRunning sessionId={props.sessionId} serverId={props.serverId} agentName={agentName} />;
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
    const { sessionId, serverId } = props;
    const reopen = React.useCallback(() => reopenSessionAsTerminal({ sessionId, serverId }), [serverId, sessionId]);
    return (
        <NativeTerminalSessionNotice
            testID="session-native-terminal-ended"
            title={t('sessionNativeTerminal.endedTitle')}
            body={t('sessionNativeTerminal.endedBody')}
            actionTitle={t('sessionNativeTerminal.reopen')}
            actionTestID="session-native-terminal-reopen"
            onAction={reopen}
        />
    );
});

/** A chat that still runs: switching stops it, then reopens the same conversation in the terminal. */
const NativeTerminalSessionChatRunning = React.memo(function NativeTerminalSessionChatRunning(
    props: NativeTerminalSessionContentProps & Readonly<{ agentName: string }>,
) {
    const { sessionId, serverId } = props;
    const switchToTerminal = React.useCallback(() => switchChatSessionToTerminal({ sessionId, serverId }), [serverId, sessionId]);
    return (
        <NativeTerminalSessionNotice
            testID="session-native-terminal-chat-running"
            title={t('sessionNativeTerminal.switchTitle')}
            body={t('sessionNativeTerminal.switchBody', { agent: props.agentName })}
            actionTitle={t('sessionNativeTerminal.switchAction')}
            actionTestID="session-native-terminal-switch"
            onAction={switchToTerminal}
        />
    );
});

const NativeTerminalSessionNotice = React.memo(function NativeTerminalSessionNotice(props: Readonly<{
    testID: string;
    title: string;
    body: string;
    actionTitle: string;
    actionTestID: string;
    onAction: () => Promise<unknown>;
}>) {
    const { onAction } = props;
    const [busy, setBusy] = React.useState(false);
    const run = React.useCallback(async () => {
        setBusy(true);
        try {
            await onAction();
        } finally {
            setBusy(false);
        }
    }, [onAction]);

    return (
        <View style={styles.ended} testID={props.testID}>
            <Text style={styles.endedTitle}>{props.title}</Text>
            <Text style={styles.endedBody}>{props.body}</Text>
            <RoundButton
                size="normal"
                title={props.actionTitle}
                action={run}
                loading={busy}
                testID={props.actionTestID}
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
