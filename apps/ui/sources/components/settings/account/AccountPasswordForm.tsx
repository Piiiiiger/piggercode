import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { PASSWORD_MIN_LENGTH, normalizePasswordLoginName } from '@piggercode/protocol';

import { useAuth } from '@/auth/context/AuthContext';
import {
    PasswordLoginError,
    readAccountPasswordUsername,
    setAccountPassword,
    type PasswordLoginErrorCode,
} from '@/auth/password/passwordLogin';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { SETTINGS_TEXT_INPUT_METRICS } from '@/components/ui/forms/settingsTextInputMetrics';
import { Text, TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';

type FormFeedback =
    | Readonly<{ kind: 'error'; field: 'username' | 'password' | 'confirm' | 'form'; text: string }>
    | Readonly<{ kind: 'saved'; username: string }>;

function feedbackForError(code: PasswordLoginErrorCode): FormFeedback {
    switch (code) {
        case 'username-taken':
            return { kind: 'error', field: 'username', text: t('passwordLogin.usernameTaken') };
        case 'invalid-username':
            return { kind: 'error', field: 'username', text: t('passwordLogin.usernameHint') };
        case 'password-too-short':
            return { kind: 'error', field: 'password', text: t('passwordLogin.passwordHint', { count: PASSWORD_MIN_LENGTH }) };
        case 'secret-unavailable':
            return { kind: 'error', field: 'form', text: t('passwordLogin.secretUnavailable') };
        default:
            return { kind: 'error', field: 'form', text: t('passwordLogin.unavailable') };
    }
}

/**
 * Sets or replaces the signed-in account's username and password. The password is stretched on this
 * device and only the derived login key and the sealed account key reach the relay.
 */
export function AccountPasswordForm(): React.ReactElement {
    const auth = useAuth();
    const styles = stylesheet;
    const credentials = auth.credentials;
    const [currentUsername, setCurrentUsername] = React.useState<string | null | undefined>(undefined);
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirm, setConfirm] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [feedback, setFeedback] = React.useState<FormFeedback | null>(null);

    React.useEffect(() => {
        if (!credentials) return;
        let cancelled = false;
        readAccountPasswordUsername(credentials).then((name) => {
            if (cancelled) return;
            setCurrentUsername(name);
            setUsername((value) => (value.length > 0 ? value : name ?? ''));
        }, () => {
            // The status line stays hidden; saving still reports its own outcome.
        });
        return () => {
            cancelled = true;
        };
    }, [credentials]);

    const save = async () => {
        if (!credentials || saving) return;
        if (!normalizePasswordLoginName(username)) {
            setFeedback(feedbackForError('invalid-username'));
            return;
        }
        if (password.length < PASSWORD_MIN_LENGTH) {
            setFeedback(feedbackForError('password-too-short'));
            return;
        }
        if (password !== confirm) {
            setFeedback({ kind: 'error', field: 'confirm', text: t('passwordLogin.passwordMismatch') });
            return;
        }
        setSaving(true);
        setFeedback(null);
        try {
            const saved = await setAccountPassword({ credentials, username, password });
            setCurrentUsername(saved);
            setUsername(saved);
            setPassword('');
            setConfirm('');
            setFeedback({ kind: 'saved', username: saved });
        } catch (error) {
            setFeedback(feedbackForError(error instanceof PasswordLoginError ? error.code : 'unavailable'));
        } finally {
            setSaving(false);
        }
    };

    const errorFor = (field: 'username' | 'password' | 'confirm' | 'form') =>
        feedback?.kind === 'error' && feedback.field === field ? feedback.text : null;

    return (
        <View testID="account-password-form" style={styles.form}>
            <Text style={styles.intro}>{t('passwordLogin.settingsIntro')}</Text>
            {currentUsername !== undefined ? (
                <Text testID="account-password-status" style={styles.status}>
                    {currentUsername
                        ? t('passwordLogin.currentUsername', { username: currentUsername })
                        : t('passwordLogin.noPasswordYet')}
                </Text>
            ) : null}
            <FieldItem
                label={t('passwordLogin.usernameLabel')}
                supportingText={errorFor('username') ?? t('passwordLogin.usernameHint')}
                supportingTextStyle={errorFor('username') ? styles.errorText : undefined}
            >
                <TextInput
                    testID="account-password-username"
                    style={styles.textInput}
                    value={username}
                    onChangeText={setUsername}
                    accessibilityLabel={t('passwordLogin.usernameLabel')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    editable={!saving}
                />
            </FieldItem>
            <FieldItem
                label={t('passwordLogin.newPasswordLabel')}
                supportingText={errorFor('password') ?? t('passwordLogin.passwordHint', { count: PASSWORD_MIN_LENGTH })}
                supportingTextStyle={errorFor('password') ? styles.errorText : undefined}
            >
                <TextInput
                    testID="account-password-new"
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    accessibilityLabel={t('passwordLogin.newPasswordLabel')}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    editable={!saving}
                />
            </FieldItem>
            <FieldItem
                label={t('passwordLogin.confirmPasswordLabel')}
                supportingText={errorFor('confirm')}
                supportingTextStyle={styles.errorText}
            >
                <TextInput
                    testID="account-password-confirm"
                    style={styles.textInput}
                    value={confirm}
                    onChangeText={setConfirm}
                    accessibilityLabel={t('passwordLogin.confirmPasswordLabel')}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    editable={!saving}
                    onSubmitEditing={() => void save()}
                />
            </FieldItem>
            {errorFor('form') ? (
                <Text testID="account-password-error" accessibilityLiveRegion="polite" style={styles.errorText}>
                    {errorFor('form')}
                </Text>
            ) : null}
            {feedback?.kind === 'saved' ? (
                <Text testID="account-password-saved" accessibilityLiveRegion="polite" style={styles.savedText}>
                    {t('passwordLogin.saved', { username: feedback.username })}
                </Text>
            ) : null}
            <RoundButton
                testID="account-password-save"
                title={t('passwordLogin.save')}
                disabled={!credentials || saving || password.length === 0}
                loading={saving}
                onPress={() => void save()}
            />
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    form: {
        gap: 16,
    },
    intro: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
    },
    status: {
        fontSize: 14,
        color: theme.colors.text.primary,
    },
    textInput: {
        ...SETTINGS_TEXT_INPUT_METRICS,
        backgroundColor: theme.colors.input.background,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ ios: 10, default: 12 }),
        borderWidth: 0.5,
        borderColor: theme.colors.border.default,
        color: theme.colors.text.primary,
    },
    errorText: {
        fontSize: 13,
        color: theme.colors.state.danger.foreground,
    },
    savedText: {
        fontSize: 13,
        color: theme.colors.state.success.foreground,
    },
}));
