import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { AgentId } from '@/agents/catalog/catalog';
import type { ProviderLocalAuthLaunch } from '@/agents/providers/shared/providerLocalAuthPlugin';
import type { EmbeddedTerminalRendererHandle } from '@/components/sessions/terminal/embeddedTerminalRendererHandle';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text, TextInput } from '@/components/ui/text/Text';
import { useMachineTerminalSession } from '@/hooks/machine/useMachineTerminalSession';
import { useMachine } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import { buildTerminalAutoExitCommand } from './buildTerminalAutoExitCommand';

/**
 * The login runs in a terminal on the machine that nobody sees, and a terminal needs a size. The login prints its link
 * on one line whatever the width (`claude auth login`, Claude Code 2.1), so any ordinary size does.
 */
const HIDDEN_TERMINAL_COLS = 120;
const HIDDEN_TERMINAL_ROWS = 30;

/** A terminal's output as plain lines: escape sequences out, carriage returns as line ends. */
function readTerminalLines(output: string): string[] {
    return output
        .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\u001b./g, '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
}

/**
 * A provider login that prints a sign-in link and then asks for the code the sign-in page shows
 * (`signIn: 'link_then_code'`), shown as that link and a box for the code instead of a terminal: the login runs in a
 * terminal on the machine (`useMachineTerminalSession`), whose link the machine finds in its output, and the code is
 * typed into it. When the login ends, its own words say how it went and the screen checks the login again.
 */
export const ProviderAuthenticationLinkLogin = React.memo(function ProviderAuthenticationLinkLogin(props: Readonly<{
    providerId: AgentId;
    machineId: string | null;
    machineHomeDir: string | null;
    authLaunch: ProviderLocalAuthLaunch;
    /** The login ended, signed in or not. */
    onEnded: () => void;
    /** Closes this view; a login still running stops. */
    onRequestClose: () => void;
    /** Starts over with a new link. */
    onRestart: () => void;
}>) {
    const { theme } = useUnistyles();
    const machine = useMachine(props.machineId ?? '');
    const platform = machine?.metadata?.platform;

    // Each view runs its own login: a link from an earlier one is never shown again.
    const [attemptId] = React.useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const outputRef = React.useRef('');
    const [output, setOutput] = React.useState('');
    const terminalRef = React.useRef<EmbeddedTerminalRendererHandle | null>(null);
    if (terminalRef.current === null) {
        terminalRef.current = {
            write: (data) => {
                outputRef.current += data;
                setOutput(outputRef.current);
            },
            clear: () => {
                outputRef.current = '';
                setOutput('');
            },
            reset: () => {
                outputRef.current = '';
                setOutput('');
            },
        };
    }

    const initialCommand = React.useMemo(
        () => props.authLaunch.initialCommand
            ? buildTerminalAutoExitCommand(props.authLaunch.initialCommand, platform, { exit: 'always' })
            : null,
        [platform, props.authLaunch.initialCommand],
    );
    const controller = useMachineTerminalSession({
        machineId: props.machineId,
        cwd: String(props.machineHomeDir ?? '').trim() || '/',
        machineReachable: Boolean(props.machineId && machine && isMachineOnline(machine)),
        machineRpcTargetAvailable: Boolean(props.machineId),
        terminalKey: `provider-link-login:${props.machineId ?? 'none'}:${props.providerId}:${attemptId}`,
        terminalRef,
        initialCommand,
        closeOnUnmount: true,
    });
    const { onInput, onReady, retryConnect } = controller;
    React.useEffect(() => {
        // No terminal is drawn here: the session starts once it has a size.
        onReady(HIDDEN_TERMINAL_COLS, HIDDEN_TERMINAL_ROWS);
    }, [onReady]);

    const link = controller.detectedUrl?.url ?? null;
    // Typed input is not kept while the terminal connects again: the code goes in only while it is connected.
    const connected = controller.status === 'connected';
    const ended = controller.status === 'exited';
    const failed = controller.status === 'error';
    const [code, setCode] = React.useState('');
    /** How much output there was when the code went in: what follows is the login's answer. */
    const [submittedAt, setSubmittedAt] = React.useState<number | null>(null);
    const submittedCode = React.useRef('');

    const submit = React.useCallback(() => {
        const value = code.trim();
        if (!value || !link || !connected || submittedAt !== null) return;
        submittedCode.current = value;
        setSubmittedAt(outputRef.current.length);
        onInput(`${value}\r`);
    }, [code, connected, link, onInput, submittedAt]);

    const { onEnded } = props;
    const reportedEnd = React.useRef(false);
    React.useEffect(() => {
        if (!ended || reportedEnd.current) return;
        reportedEnd.current = true;
        onEnded();
    }, [ended, onEnded]);

    // What the login said: after the code, its answer (the typed code echoed back and the shell's own "exit" left
    // out); before it, everything (a login that stopped early says why).
    const answerLines = readTerminalLines(submittedAt === null ? output : output.slice(submittedAt))
        .filter((line) => line !== submittedCode.current && line !== 'exit');

    let body: React.ReactNode;
    if (failed) {
        body = (
            <>
                <Text style={styles.secondary}>{t('settingsProviders.authentication.linkLogin.failed')}</Text>
                <View style={styles.buttons}>
                    <RoundButton testID="provider-link-login-retry" size="normal" title={t('settingsProviders.authentication.linkLogin.retry')} onPress={retryConnect} />
                    <RoundButton testID="provider-link-login-cancel" size="normal" display="inverted" title={t('settingsProviders.authentication.linkLogin.cancel')} onPress={props.onRequestClose} />
                </View>
            </>
        );
    } else if (ended) {
        body = (
            <>
                <Text style={styles.secondary}>{t('settingsProviders.authentication.linkLogin.ended')}</Text>
                {answerLines.length > 0 ? (
                    <Text testID="provider-link-login-answer" selectable style={styles.answer}>{answerLines.join('\n')}</Text>
                ) : null}
                <View style={styles.buttons}>
                    <RoundButton testID="provider-link-login-done" size="normal" title={t('settingsProviders.authentication.linkLogin.done')} onPress={props.onRequestClose} />
                    <RoundButton testID="provider-link-login-restart" size="normal" display="inverted" title={t('settingsProviders.authentication.linkLogin.restart')} onPress={props.onRestart} />
                </View>
            </>
        );
    } else if (!link) {
        body = (
            <>
                <Text style={styles.secondary}>{t('settingsProviders.authentication.linkLogin.starting')}</Text>
                <View style={styles.buttons}>
                    <RoundButton testID="provider-link-login-cancel" size="normal" display="inverted" title={t('settingsProviders.authentication.linkLogin.cancel')} onPress={props.onRequestClose} />
                </View>
            </>
        );
    } else {
        const verifying = submittedAt !== null;
        body = (
            <>
                <Text style={styles.step}>{t('settingsProviders.authentication.linkLogin.openStep')}</Text>
                <Text testID="provider-link-login-link" selectable numberOfLines={2} style={styles.link}>{link}</Text>
                <View style={styles.buttons}>
                    <RoundButton
                        testID="provider-link-login-open"
                        size="normal"
                        title={t('settingsProviders.authentication.linkLogin.open')}
                        onPress={() => void openExternalUrl(link, Platform.OS === 'web' ? { platformOS: 'web' } : undefined)}
                    />
                    <RoundButton
                        testID="provider-link-login-copy"
                        size="normal"
                        display="inverted"
                        title={t('settingsProviders.authentication.linkLogin.copy')}
                        onPress={() => void setClipboardStringSafe(link)}
                    />
                </View>
                <Text style={styles.step}>{t('settingsProviders.authentication.linkLogin.codeStep')}</Text>
                <TextInput
                    testID="provider-link-login-code"
                    value={code}
                    onChangeText={setCode}
                    onSubmitEditing={submit}
                    editable={!verifying}
                    placeholder={t('settingsProviders.authentication.linkLogin.codePlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                />
                <View style={styles.buttons}>
                    <RoundButton
                        testID="provider-link-login-submit"
                        size="normal"
                        title={verifying
                            ? t('settingsProviders.authentication.linkLogin.verifying')
                            : t('settingsProviders.authentication.linkLogin.submit')}
                        disabled={verifying || !connected || !code.trim()}
                        onPress={submit}
                    />
                    <RoundButton testID="provider-link-login-cancel" size="normal" display="inverted" title={t('settingsProviders.authentication.linkLogin.cancel')} onPress={props.onRequestClose} />
                </View>
            </>
        );
    }

    return (
        <ItemGroup title={t('settingsProviders.authentication.linkLogin.title')}>
            <View style={styles.body}>{body}</View>
        </ItemGroup>
    );
});

const styles = StyleSheet.create((theme) => ({
    body: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
    },
    secondary: {
        color: theme.colors.text.secondary,
    },
    step: {
        color: theme.colors.text.primary,
    },
    link: {
        color: theme.colors.text.secondary,
    },
    answer: {
        color: theme.colors.text.primary,
    },
    buttons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    input: {
        minHeight: 42,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
}));
