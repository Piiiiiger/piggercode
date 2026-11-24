import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import {
  SYSTEM_TASK_PROTOCOL_VERSION,
  type ConnectedServiceId,
  type SystemTaskEvent,
  type SystemTaskResult,
} from '@piggercode/protocol';

import { useAuth } from '@/auth/context/AuthContext';
import { getSystemTasksRunner } from '@/components/systemTasks/systemTasksRuntime';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text, TextInput } from '@/components/ui/text/Text';
import { getConnectedServiceOauthAdapter } from '@/sync/domains/connectedServices/oauth/connectedServiceOauthAdapters';
import { t } from '@/text';
import { generateOauthState, generatePkceCodes } from '@/utils/auth/oauthCore';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { openExternalUrl } from '@/utils/url/openExternalUrl';

import { completeConnectedServiceOauthCallback, type ConnectedServiceOauthAttempt } from './completeConnectedServiceOauthCallback';
import { resolveConnectedServiceOauthErrorMessage } from './resolveConnectedServiceOauthErrorMessage';
import { resolveConnectedServiceOauthPasteCopy } from './resolveConnectedServiceOauthPasteCopy';

/** The desktop's hsetup task that catches the redirect (apps/bootstrap, kinds/oauthCallback.ts). */
export const CONNECTED_SERVICE_OAUTH_CALLBACK_TASK_KIND = 'connectedServices.oauthCallback.v1';

/**
 * How long one attempt listens for the browser. A sign-in with two-step verification fits well inside it; past
 * it the page says so and offers a new attempt, and the task frees its port (Codex's is fixed) even if this
 * screen went away without cancelling it.
 */
export const CONNECTED_SERVICE_OAUTH_CALLBACK_WAIT_MS = 15 * 60_000;

type Attempt = ConnectedServiceOauthAttempt & Readonly<{ authorizationUrl: string; taskId: string }>;

type Phase =
  | Readonly<{ kind: 'starting' }>
  | Readonly<{ kind: 'waiting' }>
  | Readonly<{ kind: 'finishing' }>
  | Readonly<{ kind: 'failed'; reason: 'port_in_use' | 'timeout' | 'declined' | 'error'; message: string | null }>;

function readListeningPort(event: SystemTaskEvent): number | null {
  if (event.type !== 'listening' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  const port = (event.data as Record<string, unknown>).port;
  return typeof port === 'number' && Number.isInteger(port) && port > 0 ? port : null;
}

function readCallbackUrl(result: SystemTaskResult): string | null {
  if (!result.ok || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return null;
  const callbackUrl = (result.data as Record<string, unknown>).callbackUrl;
  return typeof callbackUrl === 'string' && callbackUrl ? callbackUrl : null;
}

function failureOf(result: Extract<SystemTaskResult, { ok: false }>): Phase {
  if (result.error.code === 'port_in_use') return { kind: 'failed', reason: 'port_in_use', message: null };
  if (result.error.code === 'timeout') return { kind: 'failed', reason: 'timeout', message: null };
  return { kind: 'failed', reason: 'error', message: result.error.message };
}

/**
 * Sign in through the system browser, as the provider's own CLI does on this computer: the desktop listens on
 * a local port, opens the provider's page, and finishes once the browser comes back. Pasting the address bar
 * stays available for a browser that did not come back.
 */
export const ConnectedServiceOauthLoopbackView = React.memo(function ConnectedServiceOauthLoopbackView(props: Readonly<{
  serviceId: ConnectedServiceId;
  profileId: string;
  serviceLabel: string;
  onDone: () => void;
  /** Codex's device code, offered when its fixed port is taken. */
  onUseDeviceCode?: () => void;
  /** The manual sign-in, offered whenever this one fails. */
  onUsePaste: () => void;
}>) {
  const { theme } = useUnistyles();
  const auth = useAuth();
  const { serviceId, profileId, onDone } = props;
  const adapter = React.useMemo(() => getConnectedServiceOauthAdapter(serviceId), [serviceId]);
  const copy = React.useMemo(() => resolveConnectedServiceOauthPasteCopy(serviceId), [serviceId]);
  const [attemptNumber, setAttemptNumber] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'starting' });
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [pasted, setPasted] = React.useState('');
  /** Why the last paste could not be used: the attempt goes on waiting for the browser. */
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  const [browserNotOpened, setBrowserNotOpened] = React.useState(false);
  const finishing = React.useRef(false);
  /** Whether this attempt's task still listens; a paste can finish an attempt whose task has ended. */
  const listening = React.useRef(false);
  /** The browser's answer that came while a paste was being checked: tried once that check is over. */
  const queuedAnswer = React.useRef<Readonly<{ attempt: Attempt; callbackUrl: string }> | null>(null);
  /** Every cancel sent: a new attempt waits for them all, so Codex's fixed port is free again. */
  const lastCancel = React.useRef<Promise<void>>(Promise.resolve());

  const cancelTask = React.useCallback((taskId: string, tag: string) => {
    const cancelled = getSystemTasksRunner().cancel(taskId).catch(() => undefined);
    lastCancel.current = Promise.all([lastCancel.current, cancelled]).then(() => undefined);
    fireAndForget(cancelled, { tag });
  }, []);

  const openBrowser = React.useCallback((url: string) => {
    setBrowserNotOpened(false);
    fireAndForget(openExternalUrl(url).then((opened) => setBrowserNotOpened(!opened)), {
      tag: 'ConnectedServiceOauthLoopbackView.openBrowser',
    });
  }, []);

  const finish = React.useCallback(async (current: Attempt, callbackUrl: string, from: 'browser' | 'paste') => {
    if (!adapter || finishing.current) return;
    finishing.current = true;
    setPasteError(null);
    setPhase({ kind: 'finishing' });
    let exchangeStarted = false;
    try {
      if (!auth.credentials) throw new Error('Not authenticated');
      const stored = await completeConnectedServiceOauthCallback({
        serviceId,
        profileId,
        adapter,
        credentials: auth.credentials,
        attempt: current,
        callbackUrl,
        missingStateError: copy?.missingStateError ?? t('connectedServices.oauthPaste.errors.missingState'),
        onExchangeStart: () => {
          exchangeStarted = true;
          // The answer is good: stop listening (a pasted address arrives while the task still waits).
          if (from === 'paste') cancelTask(current.taskId, 'ConnectedServiceOauthLoopbackView.cancelAfterPaste');
        },
      });
      if (stored) {
        onDone();
        return;
      }
      setAttempt(null);
      setPhase({ kind: 'failed', reason: 'declined', message: null });
    } catch (error) {
      const message = resolveConnectedServiceOauthErrorMessage(error, t('connectedServices.oauthPaste.alerts.failedToConnect'));
      if (from === 'paste' && !exchangeStarted) {
        // Not this sign-in's address: nothing was spent. The browser may still come back while the task
        // listens; once it has ended, the screen says so and another paste stays possible.
        setPasteError(message);
        setPhase(listening.current ? { kind: 'waiting' } : { kind: 'failed', reason: 'error', message });
        return;
      }
      // The one-use code was spent, or the browser's answer was refused: only a new attempt can go on.
      setAttempt(null);
      setPhase({ kind: 'failed', reason: 'error', message });
    } finally {
      finishing.current = false;
      const queued = queuedAnswer.current;
      queuedAnswer.current = null;
      // Only a paste that spent nothing leaves the browser's own answer worth trying.
      if (queued && from === 'paste' && !exchangeStarted) void finishRef.current(queued.attempt, queued.callbackUrl, 'browser');
    }
  }, [adapter, auth.credentials, cancelTask, copy?.missingStateError, onDone, profileId, serviceId]);
  const finishRef = React.useRef(finish);
  finishRef.current = finish;

  React.useEffect(() => {
    if (!adapter) return undefined;
    const runner = getSystemTasksRunner();
    const { port, path } = adapter.loopbackCallback;
    let active = true;
    let taskId: string | null = null;
    let unsubscribe: (() => void) | null = null;
    let current: Attempt | null = null;
    setAttempt(null);
    setPasted('');
    setPasteError(null);
    setPhase({ kind: 'starting' });
    listening.current = false;
    queuedAnswer.current = null;

    fireAndForget((async () => {
      try {
        const state = generateOauthState();
        const pkce = await generatePkceCodes();
        // A retry waits until the last attempt stopped listening: Codex's port is fixed.
        await lastCancel.current;
        if (!active) return;
        const startedTaskId = await runner.start({
          protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
          kind: CONNECTED_SERVICE_OAUTH_CALLBACK_TASK_KIND,
          params: {
            port,
            path,
            timeoutMs: CONNECTED_SERVICE_OAUTH_CALLBACK_WAIT_MS,
            page: {
              title: t('connectedServices.oauthLoopback.pageTitle'),
              message: t('connectedServices.oauthLoopback.pageMessage'),
            },
          },
        });
        taskId = startedTaskId;
        if (!active) {
          cancelTask(startedTaskId, 'ConnectedServiceOauthLoopbackView.cancelStale');
          return;
        }
        unsubscribe = runner.subscribe(startedTaskId, (event) => {
          const listeningPort = readListeningPort(event);
          if (!active || current || listeningPort === null) return;
          const redirectUri = `http://localhost:${listeningPort}${path}`;
          const authorizationUrl = adapter.buildAuthorizationUrl({ redirectUri, state, challenge: pkce.challenge });
          current = { redirectUri, state, verifier: pkce.verifier, authorizationUrl, taskId: startedTaskId };
          listening.current = true;
          setAttempt(current);
          setPhase({ kind: 'waiting' });
          openBrowser(authorizationUrl);
        }, (result) => {
          if (!active) return;
          listening.current = false;
          if (result.ok) {
            const callbackUrl = readCallbackUrl(result);
            if (current && callbackUrl) {
              if (finishing.current) queuedAnswer.current = { attempt: current, callbackUrl };
              else void finishRef.current(current, callbackUrl, 'browser');
              return;
            }
            setPhase({ kind: 'failed', reason: 'error', message: null });
            return;
          }
          // The screen's own cancel, after an answer or on leaving: nothing to show.
          if (result.error.code === 'cancelled') return;
          setPhase(failureOf(result));
        });
      } catch (error) {
        if (!active) return;
        setPhase({
          kind: 'failed',
          reason: 'error',
          message: resolveConnectedServiceOauthErrorMessage(error, t('connectedServices.oauthPaste.alerts.failedToConnect')),
        });
      }
    })(), { tag: 'ConnectedServiceOauthLoopbackView.start' });

    return () => {
      active = false;
      unsubscribe?.();
      if (taskId) cancelTask(taskId, 'ConnectedServiceOauthLoopbackView.cancelOnLeave');
    };
  }, [adapter, attemptNumber, cancelTask, openBrowser]);

  const retry = React.useCallback(() => setAttemptNumber((value) => value + 1), []);
  const reopen = React.useCallback(() => {
    if (attempt) openBrowser(attempt.authorizationUrl);
  }, [attempt, openBrowser]);
  const submitPasted = React.useCallback(() => {
    const url = pasted.trim();
    if (attempt && url) void finish(attempt, url, 'paste');
  }, [attempt, finish, pasted]);

  const busy = phase.kind === 'starting' || phase.kind === 'finishing';
  const status = (() => {
    switch (phase.kind) {
      case 'starting': return t('connectedServices.oauthLoopback.starting');
      case 'waiting':
        return browserNotOpened
          ? t('connectedServices.oauthLoopback.browserNotOpened')
          : t('connectedServices.oauthLoopback.waiting', { service: props.serviceLabel });
      case 'finishing': return t('connectedServices.oauthLoopback.finishing');
      case 'failed':
        if (phase.reason === 'port_in_use') {
          return t('connectedServices.oauthLoopback.portInUse', { port: adapter?.loopbackCallback.port ?? 0 });
        }
        if (phase.reason === 'timeout') return t('connectedServices.oauthLoopback.timedOut');
        if (phase.reason === 'declined') return t('connectedServices.oauthLoopback.declined');
        return phase.message ?? t('connectedServices.oauthPaste.alerts.failedToConnect');
    }
  })();

  return (
    <ItemList keyboardAware keyboardShouldPersistTaps="handled">
      <ItemGroup title={t('connectedServices.oauthLoopback.title', { service: props.serviceLabel })}>
        <View style={styles.body}>
          <View style={styles.statusRow}>
            {busy || phase.kind === 'waiting' ? <ActivitySpinner size={14} /> : null}
            <Text
              testID="connectedServices.oauthLoopback.status"
              style={[styles.status, phase.kind === 'failed' && { color: theme.colors.state.danger.foreground }]}
            >
              {status}
            </Text>
          </View>
          {phase.kind === 'waiting' ? (
            <RoundButton
              testID="connectedServices.oauthLoopback.reopenButton"
              size="normal"
              display="inverted"
              title={t('connectedServices.oauthLoopback.reopen')}
              onPress={reopen}
            />
          ) : null}
          {phase.kind === 'failed' ? (
            <View style={styles.actions}>
              <RoundButton
                testID="connectedServices.oauthLoopback.retryButton"
                size="normal"
                title={t('connectedServices.oauthLoopback.retry')}
                onPress={retry}
              />
              {phase.reason === 'port_in_use' && props.onUseDeviceCode ? (
                <RoundButton
                  testID="connectedServices.oauthLoopback.useDeviceCodeButton"
                  size="normal"
                  display="inverted"
                  title={t('connectedServices.oauthLoopback.useDeviceCode')}
                  onPress={props.onUseDeviceCode}
                />
              ) : null}
              <RoundButton
                testID="connectedServices.oauthLoopback.usePasteButton"
                size="normal"
                display="inverted"
                title={t('connectedServices.oauthLoopback.usePaste')}
                onPress={props.onUsePaste}
              />
            </View>
          ) : null}
        </View>
      </ItemGroup>

      {attempt ? (
        <ItemGroup title={t('connectedServices.oauthLoopback.pasteTitle')}>
          <View style={styles.body}>
            <Text style={styles.hint}>{t('connectedServices.oauthLoopback.pasteBody')}</Text>
            {pasteError ? (
              <Text testID="connectedServices.oauthLoopback.pasteError" style={{ color: theme.colors.state.danger.foreground }}>
                {pasteError}
              </Text>
            ) : null}
            <TextInput
              testID="connectedServices.oauthLoopback.pasteInput"
              value={pasted}
              onChangeText={setPasted}
              placeholder={attempt.redirectUri}
              placeholderTextColor={theme.colors.input.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <RoundButton
              testID="connectedServices.oauthLoopback.pasteButton"
              size="normal"
              title={t('common.continue')}
              disabled={busy || !pasted.trim()}
              onPress={busy ? undefined : submitPasted}
            />
          </View>
        </ItemGroup>
      ) : null}
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
  actions: {
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
