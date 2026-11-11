import { accountSettingsParse, type AccountSettings } from '@piggercode/protocol';

import { dispatchActivityNotificationAsync } from '@/activity/notifications/dispatchActivityNotification';
import type { ExpoPushActivityNotificationSender } from '@/activity/notifications/sendExpoPushActivityNotification';
import { getSessionNotificationTitle } from '@/agent/runtime/readyNotificationContext';
import { sendReadyWithPushNotification } from '@/agent/runtime/sendReadyWithPushNotification';
import type { ApiSessionClient } from '@/api/session/sessionClient';
import type { NativeTerminalWaiting, NativeTerminalWaitingOn } from '@/api/types';
import { logger } from '@/ui/logger';

/** What the CLI shows: a turn in progress, a prompt waiting for the user, or its input box. */
export type NativeTerminalActivity =
  | Readonly<{ kind: 'working' }>
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'waiting'; on: NativeTerminalWaitingOn }>;

export type NativeTerminalActivitySession = Pick<
  ApiSessionClient,
  'sessionId' | 'sendSessionEvent' | 'updateAgentState' | 'getMetadataSnapshot' | 'getAgentStateSnapshot'
>;

/** The user's notification choices (account settings), read when there is something to send. */
export type NativeTerminalNotificationSettings = Readonly<{
  settings: AccountSettings;
  settingsSecretsReadKeys: ReadonlyArray<Uint8Array>;
}>;

export type NativeTerminalActivityReporter = Readonly<{
  report: (activity: NativeTerminalActivity) => void;
  /**
   * The CLI quit by itself (not stopped from the app). With an error, its terminal now waits for the
   * user to read its last words, and the user is told; a clean quit was the user's own doing.
   */
  cliExited: (exitCode: number) => Promise<void>;
  /** The session ends (for any reason): clears a prompt the CLI left, without telling anyone. */
  end: () => Promise<void>;
  /** Resolves once the session writes started so far are done. */
  flush: () => Promise<void>;
}>;

/**
 * Turns what a 「终端」 CLI shows into what the user's devices are told, the same way for every CLI:
 * - a turn that ends is the session's `ready` event (the app's "finished" notification and the
 *   phone's push);
 * - a prompt waiting for the user, or a CLI that quit with an error and waits for the user to close its
 *   terminal, is `agentState.terminalWaiting`, which the session's pending counts (the app's attention
 *   list, badge and notification, even for a session the app does not show) follow, plus a push.
 * Only the terminal can answer, so nothing here offers to answer.
 */
export function createNativeTerminalActivityReporter(params: Readonly<{
  session: NativeTerminalActivitySession;
  /** The CLI's name in notifications, e.g. "Claude Code". */
  agentName: string;
  logPrefix: string;
  pushSender: ExpoPushActivityNotificationSender & Readonly<{
    sendToAllDevices?: (title: string, body: string, data: { sessionId: string }) => void;
  }>;
  readAccountSettings: () => Promise<NativeTerminalNotificationSettings | null>;
}>): NativeTerminalActivityReporter {
  const { session } = params;
  let turnInProgress = false;
  let waiting: NativeTerminalWaiting['on'] | null = null;
  // Session writes run one after another, so a prompt's start and end reach the session in order.
  let writes: Promise<void> = Promise.resolve();
  const write = (label: string, run: () => Promise<void>): Promise<void> => {
    writes = writes.then(run).catch((error) => {
      logger.debug(`${params.logPrefix} Could not ${label}`, error);
    });
    return writes;
  };

  // A runner that died while its CLI showed a prompt left it recorded; this runner starts clean.
  if (session.getAgentStateSnapshot()?.terminalWaiting) {
    void write('clear an old prompt', () => session.updateAgentState((state) => ({ ...state, terminalWaiting: null })));
  }

  const sessionTitle = () => getSessionNotificationTitle(() => session.getMetadataSnapshot());
  // Settings that cannot be read (the relay is away) count as untouched ones: every notification on.
  const readSettings = async (): Promise<NativeTerminalNotificationSettings> => {
    try {
      const read = await params.readAccountSettings();
      if (read) return read;
    } catch (error) {
      logger.debug(`${params.logPrefix} Could not read the notification settings`, error);
    }
    return { settings: accountSettingsParse({}), settingsSecretsReadKeys: [] };
  };
  const notify = (event: Parameters<typeof dispatchActivityNotificationAsync>[0]['event']): void => {
    void (async () => {
      const notificationSettings = await readSettings();
      await dispatchActivityNotificationAsync({
        settings: notificationSettings.settings,
        settingsSecretsReadKeys: notificationSettings.settingsSecretsReadKeys,
        expoPushSender: params.pushSender,
        event,
      });
    })().catch((error) => {
      logger.debug(`${params.logPrefix} Could not send a notification`, error);
    });
  };

  const recordWaiting = (next: NativeTerminalWaiting | null): Promise<void> => {
    waiting = next?.on ?? null;
    return write('record what the terminal waits for', () => session.updateAgentState((state) => ({
      ...state,
      terminalWaiting: next,
    })));
  };
  const setWaiting = (next: NativeTerminalWaitingOn | null): void => {
    if (next === waiting) return;
    void recordWaiting(next ? { on: next, since: Date.now() } : null);
    if (!next) return;
    notify({
      topic: 'terminal_waiting',
      sessionId: session.sessionId,
      sessionTitle: sessionTitle(),
      agentDisplayName: params.agentName,
      on: next,
    });
  };

  const turnFinished = (): void => {
    void write('report the finished turn', async () => {
      const notificationSettings = await readSettings();
      sendReadyWithPushNotification({
        session,
        pushSender: params.pushSender,
        waitingForCommandLabel: params.agentName,
        logPrefix: params.logPrefix,
        sessionTitle: sessionTitle(),
        accountSettings: notificationSettings.settings,
        settingsSecretsReadKeys: notificationSettings.settingsSecretsReadKeys,
      });
    });
  };

  return {
    report: (activity) => {
      if (activity.kind === 'waiting') {
        turnInProgress = true;
        setWaiting(activity.on);
        return;
      }
      setWaiting(null);
      if (activity.kind === 'working') {
        turnInProgress = true;
        return;
      }
      if (!turnInProgress) return;
      turnInProgress = false;
      turnFinished();
    },
    cliExited: async (exitCode) => {
      setWaiting(null);
      turnInProgress = false;
      if (exitCode === 0) {
        await writes;
        return;
      }
      await recordWaiting({ on: 'exited', exitCode, since: Date.now() });
      notify({
        topic: 'session_ended',
        sessionId: session.sessionId,
        sessionTitle: sessionTitle(),
        agentDisplayName: params.agentName,
        exitCode,
      });
    },
    end: async () => {
      turnInProgress = false;
      if (waiting) await recordWaiting(null);
      await writes;
    },
    flush: () => writes,
  };
}
