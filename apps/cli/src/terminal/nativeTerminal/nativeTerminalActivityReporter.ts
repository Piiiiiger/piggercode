import { accountSettingsParse, type AccountSettings } from '@piggercode/protocol';

import { dispatchActivityNotificationAsync } from '@/activity/notifications/dispatchActivityNotification';
import type { ExpoPushActivityNotificationSender } from '@/activity/notifications/sendExpoPushActivityNotification';
import { getSessionNotificationTitle } from '@/agent/runtime/readyNotificationContext';
import { sendReadyWithPushNotification } from '@/agent/runtime/sendReadyWithPushNotification';
import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
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

/** The user's notification choices (account settings). */
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
  /**
   * Writes again what the terminal waits for if the last write did not reach the relay. The runner
   * calls it with its heartbeat, so a lost clear heals while the CLI shows nothing new.
   */
  retryUnsaved: () => void;
  /** The session ends (for any reason): clears what the terminal waited for, without telling anyone. */
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
  /** The notification choices as last read, without waiting for the relay; null while unknown. */
  readAccountSettings: () => NativeTerminalNotificationSettings | null;
}>): NativeTerminalActivityReporter {
  const { session } = params;
  let turnInProgress = false;
  // Session writes run one after another, so a prompt's start and end reach the session in order.
  let writes: Promise<void> = Promise.resolve();
  const write = (label: string, run: () => Promise<void>): Promise<void> => {
    writes = writes.then(run).catch((error) => {
      logger.infoFile(`${params.logPrefix} Could not ${label}`, serializeAxiosErrorForLog(error));
    });
    return writes;
  };

  // What the terminal waits for, and whether the session has it. A write that did not reach the relay
  // (away for longer than a write waits) is made again with the next report or heartbeat, and when the
  // session ends, so a prompt that is gone never stays on the session.
  let waiting: NativeTerminalWaiting | null = null;
  let waitingPublished = true;
  let waitingWritesInFlight = 0;
  const writeWaiting = (next: NativeTerminalWaiting | null): Promise<void> => {
    waitingWritesInFlight += 1;
    return write('record what the terminal waits for', async () => {
      try {
        await session.updateAgentState((state) => ({ ...state, terminalWaiting: next }));
        if (waiting === next) waitingPublished = true;
      } catch (error) {
        if (waiting === next) waitingPublished = false;
        throw error;
      } finally {
        waitingWritesInFlight -= 1;
      }
    });
  };
  const changeWaiting = (next: NativeTerminalWaiting | null): Promise<void> => {
    waiting = next;
    waitingPublished = false;
    return writeWaiting(next);
  };
  const retryWaiting = (): void => {
    if (!waitingPublished && waitingWritesInFlight === 0) void writeWaiting(waiting);
  };

  // A runner that died while its CLI showed a prompt left it recorded; this runner starts clean.
  if (session.getAgentStateSnapshot()?.terminalWaiting) {
    void changeWaiting(null);
  }

  const sessionTitle = () => getSessionNotificationTitle(() => session.getMetadataSnapshot());
  // Choices not known yet count as untouched ones: every notification on.
  const notificationSettings = (): NativeTerminalNotificationSettings => {
    try {
      const known = params.readAccountSettings();
      if (known) return known;
    } catch (error) {
      logger.infoFile(`${params.logPrefix} Could not read the notification settings`, serializeAxiosErrorForLog(error));
    }
    return { settings: accountSettingsParse({}), settingsSecretsReadKeys: [] };
  };
  const notify = (event: Parameters<typeof dispatchActivityNotificationAsync>[0]['event']): void => {
    const { settings, settingsSecretsReadKeys } = notificationSettings();
    void dispatchActivityNotificationAsync({
      settings,
      settingsSecretsReadKeys,
      expoPushSender: params.pushSender,
      event,
    }).catch((error) => {
      logger.infoFile(`${params.logPrefix} Could not send a notification`, serializeAxiosErrorForLog(error));
    });
  };

  const setWaiting = (next: NativeTerminalWaitingOn | null): void => {
    if ((waiting?.on ?? null) === next) {
      retryWaiting();
      return;
    }
    void changeWaiting(next ? { on: next, since: Date.now() } : null);
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
    const { settings, settingsSecretsReadKeys } = notificationSettings();
    sendReadyWithPushNotification({
      session,
      pushSender: params.pushSender,
      waitingForCommandLabel: params.agentName,
      logPrefix: params.logPrefix,
      sessionTitle: sessionTitle(),
      accountSettings: settings,
      settingsSecretsReadKeys,
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
      turnInProgress = false;
      // A prompt the CLI left is cleared first, so the exit starts a wait of its own in the app.
      setWaiting(null);
      if (exitCode !== 0) {
        void changeWaiting({ on: 'exited', exitCode, since: Date.now() });
        notify({
          topic: 'session_ended',
          sessionId: session.sessionId,
          sessionTitle: sessionTitle(),
          agentDisplayName: params.agentName,
          exitCode,
        });
      }
      await writes;
    },
    retryUnsaved: retryWaiting,
    end: async () => {
      turnInProgress = false;
      if (waiting) void changeWaiting(null);
      await writes;
      // A write that was still on its way and failed gets one more try before the session ends.
      if (!waitingPublished) {
        void writeWaiting(waiting);
        await writes;
      }
    },
    flush: () => writes,
  };
}
