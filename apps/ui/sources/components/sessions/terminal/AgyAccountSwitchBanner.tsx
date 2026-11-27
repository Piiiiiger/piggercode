import * as React from 'react';
import { View } from 'react-native';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { embeddedTerminalPaneStyles } from '@/components/terminal/embedded/embeddedTerminalPaneStyles';
import { agyAccountLabel } from '@/sync/domains/connectedServices/agyAccountLabel';
import {
    AGY_SWITCHED_BANNER_VISIBLE_MS,
    readAgyAccountId,
    readAgyAccountSwitch,
    type AgyAccountSwitchStateV1,
} from '@/sync/domains/connectedServices/agyAccountSwitch';
import { confirmAgyAccountSwitch } from '@/sync/ops/agyAccountSwitch';
import { storage } from '@/sync/domains/state/storageStore';
import { t } from '@/text';
import { AGY_DEFAULT_ACCOUNT_ID } from '@piggercode/protocol';

/** setTimeout's longest delay (32-bit signed milliseconds); a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

function formatLocalTime(ms: number): string {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function accountName(id: string | undefined): string {
    return id ? agyAccountLabel({ accountId: id }) : t('terminalEmbedded.agyAccount.otherAccount');
}

function waitingDetail(waitingFor: AgyAccountSwitchStateV1['waitingFor']): string | null {
    switch (waitingFor) {
        case 'idle': return t('terminalEmbedded.agyAccount.waitingFor.idle');
        case 'input': return t('terminalEmbedded.agyAccount.waitingFor.input');
        case 'draft': return t('terminalEmbedded.agyAccount.waitingFor.draft');
        case 'conversation': return t('terminalEmbedded.agyAccount.waitingFor.conversation');
        case 'unknown_input': return t('terminalEmbedded.agyAccount.waitingFor.unknownInput');
        default: return null;
    }
}

function stateMessage(state: AgyAccountSwitchStateV1): string | null {
    switch (state.state) {
        case 'waiting': {
            const to = accountName(state.toAccountId);
            const base = state.reason === 'low'
                ? t('terminalEmbedded.agyAccount.waitingLow', { to })
                : t('terminalEmbedded.agyAccount.waitingExhausted', { to });
            const detail = waitingDetail(state.waitingFor);
            return detail ? `${base} ${detail}` : base;
        }
        case 'needs_confirmation':
            return state.reason === 'low'
                ? t('terminalEmbedded.agyAccount.needsConfirmationLow')
                : t('terminalEmbedded.agyAccount.needsConfirmationExhausted');
        case 'switched':
            return t('terminalEmbedded.agyAccount.switched', {
                from: accountName(state.fromAccountId),
                to: accountName(state.toAccountId),
            });
        case 'all_exhausted':
            return typeof state.earliestResetAtMs === 'number'
                ? t('terminalEmbedded.agyAccount.allExhaustedAt', { time: formatLocalTime(state.earliestResetAtMs) })
                : t('terminalEmbedded.agyAccount.allExhausted');
        case 'failed':
            return state.failure === 'target_start_failed'
                ? t('terminalEmbedded.agyAccount.failedTarget', {
                    to: accountName(state.toAccountId),
                    from: accountName(state.fromAccountId),
                })
                : t('terminalEmbedded.agyAccount.failedSource');
        case 'none':
            return null;
    }
}

type ConfirmFailure = 'unsupported' | 'failed' | null;

/**
 * The agy login switch above a session's terminal: what the runner reports in `agyAccountSwitchV1`, and the
 * one button it can need. Renders nothing for an old CLI, which writes neither field.
 */
export const AgyAccountSwitchBanner = React.memo(function AgyAccountSwitchBanner(props: Readonly<{
    sessionId: string;
    testIdPrefix?: string | null;
}>) {
    const styles = embeddedTerminalPaneStyles;
    const metadata = storage((s) => s.sessions[props.sessionId]?.metadata ?? null);
    const state = React.useMemo(() => readAgyAccountSwitch(metadata), [metadata]);
    const accountId = React.useMemo(() => readAgyAccountId(metadata), [metadata]);

    const requestId = state?.requestId ?? null;
    const [pendingRequestId, setPendingRequestId] = React.useState<string | null>(null);
    const [confirmFailure, setConfirmFailure] = React.useState<{ requestId: string | null; kind: ConfirmFailure }>({
        requestId: null,
        kind: null,
    });

    // `switched` is a short notice: hide it once its minute is up.
    const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
    // `all_exhausted` is stale once its reset time has passed: a machine with one login never reads again to clear it.
    const hideAtMs = state?.state === 'switched'
        ? state.updatedAtMs + AGY_SWITCHED_BANNER_VISIBLE_MS
        : state?.state === 'all_exhausted' && typeof state.earliestResetAtMs === 'number'
            ? state.earliestResetAtMs
            : null;
    React.useEffect(() => {
        if (hideAtMs === null) return;
        const remaining = hideAtMs - Date.now();
        if (remaining <= 0) return;
        // Capped: a longer delay would fire at once (only a malformed reset time weeks away gets here).
        const timer = setTimeout(forceRender, Math.min(remaining, MAX_TIMEOUT_MS));
        return () => clearTimeout(timer);
    }, [hideAtMs]);

    const onConfirm = React.useCallback(() => {
        if (!requestId) return;
        setPendingRequestId(requestId);
        // A new try starts clean: an earlier failure's note does not stay beside it.
        setConfirmFailure({ requestId: null, kind: null });
        void confirmAgyAccountSwitch({ sessionId: props.sessionId, requestId }).then((result) => {
            if (result === 'unsupported' || result === 'failed') {
                setConfirmFailure({ requestId, kind: result });
                // A refusal that can be retried frees the button; an old CLI never will accept it.
                if (result === 'failed') setPendingRequestId((current) => (current === requestId ? null : current));
            }
            // `done`: the button stays down until the runner moves the state on. `stale`: the state is already moving on.
            // Neither leaves a failure note behind.
        });
    }, [props.sessionId, requestId]);

    if (!state) return null;

    const expired = hideAtMs !== null && Date.now() >= hideAtMs;
    const message = expired ? null : stateMessage(state);
    const showSudoNote = state.sudoUnavailable === true && accountId !== AGY_DEFAULT_ACCOUNT_ID;
    if (!message && !showSudoNote) return null;

    const testId = (suffix: string) => (props.testIdPrefix ? `${props.testIdPrefix}-${suffix}` : undefined);
    const failure = confirmFailure.requestId === requestId ? confirmFailure.kind : null;
    const showConfirm = state.state === 'needs_confirmation' && requestId !== null && failure !== 'unsupported';
    const failureMessage = failure === 'unsupported'
        ? t('terminalEmbedded.agyAccount.needsUpdate')
        : failure === 'failed'
            ? t('terminalEmbedded.agyAccount.confirmFailed')
            : null;

    return (
        <View testID={testId('agy-account-banner')} style={{ flexDirection: 'column' }} accessibilityLiveRegion="polite">
            {message ? (
                <View style={styles.banner}>
                    <Text testID={testId('agy-account-message')} style={styles.bannerUrl}>
                        {failureMessage ? `${message} ${failureMessage}` : message}
                    </Text>
                    {showConfirm ? (
                        <RoundButton
                            testID={testId('agy-account-confirm')}
                            size="small"
                            title={t('terminalEmbedded.agyAccount.confirm')}
                            disabled={pendingRequestId === requestId}
                            loading={pendingRequestId === requestId}
                            onPress={onConfirm}
                        />
                    ) : null}
                </View>
            ) : null}
            {showSudoNote ? (
                <View style={styles.banner}>
                    <Text testID={testId('agy-account-sudo')} style={styles.bannerUrl}>
                        {t('terminalEmbedded.agyAccount.sudoUnavailable')}
                    </Text>
                </View>
            ) : null}
        </View>
    );
});
