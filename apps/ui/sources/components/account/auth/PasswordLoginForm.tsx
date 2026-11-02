import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { loginWithPassword, PasswordLoginError } from '@/auth/password/passwordLogin';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { SETTINGS_TEXT_INPUT_METRICS } from '@/components/ui/forms/settingsTextInputMetrics';
import { Text, TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';

export type PasswordLoginFormProps = Readonly<{
    /** Opens the recovery-key sign-in for accounts without a password yet. */
    onUseRecoveryKey: () => void;
}>;

/**
 * Username and password sign-in. A successful sign-in stores the credentials through the regular
 * auth owner, so the session survives reloads exactly like any other login.
 */
export function PasswordLoginForm(props: PasswordLoginFormProps): React.ReactElement {
    const auth = useAuth();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [errorText, setErrorText] = React.useState<string | null>(null);
    const passwordInputRef = React.useRef<any>(null);
    const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

    const submit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setErrorText(null);
        try {
            const session = await loginWithPassword({ username, password });
            await auth.login(session.token, session.secret);
        } catch (error) {
            setErrorText(error instanceof PasswordLoginError && error.code === 'invalid-credentials'
                ? t('passwordLogin.invalidCredentials')
                : t('passwordLogin.unavailable'));
            setSubmitting(false);
        }
    };

    return (
        <View testID="password-login-form" style={styles.form}>
            <FieldItem label={t('passwordLogin.usernameLabel')}>
                <TextInput
                    testID="password-login-username"
                    style={styles.textInput}
                    value={username}
                    onChangeText={setUsername}
                    accessibilityLabel={t('passwordLogin.usernameLabel')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    returnKeyType="next"
                    editable={!submitting}
                    onSubmitEditing={() => passwordInputRef.current?.focus?.()}
                />
            </FieldItem>
            <FieldItem label={t('passwordLogin.passwordLabel')}>
                <TextInput
                    ref={passwordInputRef}
                    testID="password-login-password"
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    accessibilityLabel={t('passwordLogin.passwordLabel')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    returnKeyType="go"
                    editable={!submitting}
                    onSubmitEditing={() => void submit()}
                />
            </FieldItem>
            {errorText ? (
                <Text testID="password-login-error" accessibilityLiveRegion="polite" style={styles.errorText}>
                    {errorText}
                </Text>
            ) : null}
            <RoundButton
                testID="password-login-submit"
                title={t('passwordLogin.signIn')}
                disabled={!canSubmit}
                loading={submitting}
                onPress={() => void submit()}
            />
            <Pressable
                testID="password-login-use-recovery-key"
                accessibilityRole="button"
                onPress={props.onUseRecoveryKey}
                hitSlop={8}
                style={styles.recoveryLink}
            >
                <Text style={styles.recoveryLinkText}>{t('passwordLogin.useRecoveryKey')}</Text>
            </Pressable>
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    form: {
        gap: 14,
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
    recoveryLink: {
        alignSelf: 'center',
        paddingVertical: 4,
    },
    recoveryLinkText: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        textDecorationLine: 'underline',
    },
}));
