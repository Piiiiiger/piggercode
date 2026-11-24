import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text, TextInput } from '@/components/ui/text/Text';
import { requestAgyAccountUsageRead } from '@/hooks/server/connectedServices/useAgyAccountUsage';
import { runAgyAccountLoginStep } from '@/sync/ops/agyAccountLogin';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { openExternalUrl } from '@/utils/url/openExternalUrl';

type Phase =
  | Readonly<{ kind: 'starting' }>
  /** `retry`: the last paste held no code; the same sign-in takes another. */
  | Readonly<{ kind: 'awaiting_code'; loginId: string; url: string; retry?: boolean }>
  | Readonly<{ kind: 'verifying'; loginId: string; url: string }>
  | Readonly<{ kind: 'failed'; errorCode: string }>;

function asStringParam(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function failureText(errorCode: string): string {
  switch (errorCode) {
    case 'agy_account_login_requires_encryption': return t('connectedServices.agyLogin.errors.requiresEncryption');
    case 'unsupported_platform': return t('connectedServices.agyLogin.errors.unsupportedPlatform');
    case 'agy_not_installed': return t('connectedServices.agyLogin.errors.agyNotInstalled');
    case 'agy_account_login_unavailable': return t('connectedServices.agyLogin.errors.updateCli');
    case 'login_page_not_shown': return t('connectedServices.agyLogin.errors.noSignInPage');
    case 'code_not_accepted': return t('connectedServices.agyLogin.errors.codeNotAccepted');
    case 'login_not_found': return t('connectedServices.agyLogin.errors.loginEnded');
    case 'machine_rpc_failed': return t('connectedServices.agyLogin.errors.unreachable');
    default: return t('connectedServices.agyLogin.errors.failed');
  }
}

/**
 * Adds a Google login to agy on a machine, the way agy signs in on a computer without a browser: the machine
 * starts the official agy in a new login folder, this screen opens Google's page here, and the code Google shows
 * goes back to that agy. The token stays in agy's folder on the machine.
 */
export const AgyAccountLoginView = React.memo(function AgyAccountLoginView() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const params = useLocalSearchParams();
  const machineId = asStringParam(params.machineId).trim();
  const machineName = asStringParam(params.machineName).trim() || machineId;
  const [attemptNumber, setAttemptNumber] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'starting' });
  const [code, setCode] = React.useState('');
  const [browserNotOpened, setBrowserNotOpened] = React.useState(false);
  /**
   * The machine's attempt, cancelled when this screen goes away or starts over. Only a sign-in clears it: after
   * any other answer a cancel costs nothing, and it ends an attempt the machine may still hold.
   */
  const openLogin = React.useRef<string | null>(null);
  const submitting = React.useRef(false);

  const openBrowser = React.useCallback((url: string) => {
    setBrowserNotOpened(false);
    fireAndForget(openExternalUrl(url).then((opened) => setBrowserNotOpened(!opened)), { tag: 'AgyAccountLoginView.openBrowser' });
  }, []);

  React.useEffect(() => {
    if (!machineId) return undefined;
    let active = true;
    setPhase({ kind: 'starting' });
    setCode('');
    fireAndForget((async () => {
      const step = await runAgyAccountLoginStep({ machineId, request: { action: 'start' } });
      if (step.kind !== 'started') {
        if (active) setPhase({ kind: 'failed', errorCode: step.kind === 'failed' ? step.errorCode : 'login_failed' });
        return;
      }
      if (!active) {
        fireAndForget(runAgyAccountLoginStep({ machineId, request: { action: 'cancel', loginId: step.loginId } }), {
          tag: 'AgyAccountLoginView.cancelStale',
        });
        return;
      }
      openLogin.current = step.loginId;
      setPhase({ kind: 'awaiting_code', loginId: step.loginId, url: step.url });
      openBrowser(step.url);
    })(), { tag: 'AgyAccountLoginView.start' });
    return () => {
      active = false;
    };
  }, [attemptNumber, machineId, openBrowser]);

  React.useEffect(() => () => {
    const loginId = openLogin.current;
    if (loginId) {
      fireAndForget(runAgyAccountLoginStep({ machineId, request: { action: 'cancel', loginId } }), {
        tag: 'AgyAccountLoginView.cancelOnLeave',
      });
    }
  }, [machineId]);

  const submit = React.useCallback(() => {
    if (phase.kind !== 'awaiting_code' || !code.trim() || submitting.current) return;
    submitting.current = true;
    const { loginId, url } = phase;
    setPhase({ kind: 'verifying', loginId, url });
    fireAndForget((async () => {
      try {
        const step = await runAgyAccountLoginStep({ machineId, request: { action: 'submit', loginId, code: code.trim() } });
        if (step.kind === 'signed_in') {
          openLogin.current = null;
          // The page this returns to lists the new login at once.
          requestAgyAccountUsageRead();
          router.back();
          return;
        }
        if (step.kind === 'failed' && step.errorCode === 'code_unreadable') {
          setPhase({ kind: 'awaiting_code', loginId, url, retry: true });
          return;
        }
        setPhase({ kind: 'failed', errorCode: step.kind === 'failed' ? step.errorCode : 'login_failed' });
      } finally {
        submitting.current = false;
      }
    })(), { tag: 'AgyAccountLoginView.submit' });
  }, [code, machineId, phase, router]);

  const startOver = React.useCallback(() => {
    const loginId = openLogin.current;
    openLogin.current = null;
    if (loginId) {
      fireAndForget(runAgyAccountLoginStep({ machineId, request: { action: 'cancel', loginId } }), { tag: 'AgyAccountLoginView.cancelForRetry' });
    }
    setAttemptNumber((value) => value + 1);
  }, [machineId]);

  if (!machineId) {
    return (
      <ItemList>
        <ItemGroup title={t('connectedServices.agyLogin.title', { machine: '' })}>
          <View style={styles.body}>
            <Text style={styles.hint}>{t('connectedServices.agyLogin.errors.failed')}</Text>
          </View>
        </ItemGroup>
      </ItemList>
    );
  }

  const busy = phase.kind === 'starting' || phase.kind === 'verifying';
  const status = phase.kind === 'starting'
    ? t('connectedServices.agyLogin.starting', { machine: machineName })
    : phase.kind === 'verifying'
      ? t('connectedServices.agyLogin.verifying')
      : phase.kind === 'awaiting_code'
        ? (phase.retry
          ? t('connectedServices.agyLogin.errors.codeUnreadable')
          : browserNotOpened ? t('connectedServices.oauthLoopback.browserNotOpened') : t('connectedServices.agyLogin.awaitingCode'))
        : failureText(phase.errorCode);

  return (
    <ItemList keyboardAware keyboardShouldPersistTaps="handled">
      <ItemGroup title={t('connectedServices.agyLogin.title', { machine: machineName })}>
        <View style={styles.body}>
          <View style={styles.statusRow}>
            {busy ? <ActivitySpinner size={14} /> : null}
            <Text
              testID="connectedServices.agyLogin.status"
              style={[
                styles.status,
                (phase.kind === 'failed' || (phase.kind === 'awaiting_code' && phase.retry)) && { color: theme.colors.state.danger.foreground },
              ]}
            >
              {status}
            </Text>
          </View>
          {phase.kind === 'awaiting_code' || phase.kind === 'verifying' ? (
            <>
              <RoundButton
                testID="connectedServices.agyLogin.reopenButton"
                size="normal"
                display="inverted"
                title={t('connectedServices.oauthLoopback.reopen')}
                onPress={() => openBrowser(phase.url)}
              />
              <TextInput
                testID="connectedServices.agyLogin.codeInput"
                value={code}
                onChangeText={setCode}
                placeholder={t('connectedServices.agyLogin.codePlaceholder')}
                placeholderTextColor={theme.colors.input.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                editable={phase.kind === 'awaiting_code'}
                style={styles.input}
              />
              <RoundButton
                testID="connectedServices.agyLogin.submitButton"
                size="normal"
                title={t('connectedServices.agyLogin.submit')}
                disabled={busy || !code.trim()}
                onPress={busy ? undefined : submit}
              />
            </>
          ) : null}
          {phase.kind === 'failed' ? (
            <RoundButton
              testID="connectedServices.agyLogin.startOverButton"
              size="normal"
              title={t('connectedServices.agyLogin.startOver')}
              onPress={startOver}
            />
          ) : null}
        </View>
      </ItemGroup>
    </ItemList>
  );
});

const styles = StyleSheet.create((theme) => ({
  body: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  status: {
    flex: 1,
    color: theme.colors.text.secondary,
  },
  hint: {
    color: theme.colors.text.secondary,
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
