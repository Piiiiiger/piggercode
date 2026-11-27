import {
  AGY_ACCOUNT_SWITCH_CONFIRM_RPC_METHOD,
  AGY_DEFAULT_ACCOUNT_ID,
  AgyAccountSwitchConfirmRequestV1Schema,
  type AgyAccountSessionRequestV1,
  type AgyAccountSessionResponseV1,
  type AgyAccountSwitchConfirmResponseV1,
  type AgyAccountSwitchRequestV1,
  type AgyAccountSwitchStateV1,
} from '@piggercode/protocol';

import type { Metadata } from '@/api/types';
import type {
  NativeTerminalCliControl,
  NativeTerminalCliSpec,
  NativeTerminalCliSwitcher,
} from '@/terminal/nativeTerminal/runNativeTerminalSession';
import type { OwnTerminalPane } from '@/terminal/nativeTerminal/ownTerminalPane';
import { logger } from '@/ui/logger';

import { DEFAULT_CONNECTED_SERVICE_QUOTA_FETCH_TIMEOUT_MS } from '@/daemon/connectedServices/quotas/quotaFetchTimeout';
import type { AgyStateFields } from './agyNativeTerminal';
import { readAgyInputBox, readAgyLimitNotices } from './agyScreen';

/** How often the runner looks at agy's screen, input and state: how late it notices a quota notice or a draft. */
const TICK_MS = 1_000;
/** How often the daemon hears from the runner while nothing changes: how late a switch request reaches it. */
const SIGNAL_HEARTBEAT_MS = 5_000;
/**
 * A keystroke this recent may not be on screen yet, so a draft read just now could miss it: the switch waits.
 * Longer than the gap between a keystroke and the next capture (about one tick), short enough to never be noticed.
 */
const INPUT_QUIET_MS = 5_000;

/** What agy shows the runner, per process it started (`childEpoch` counts them from 1). */
type ChildState = {
  readonly epoch: number;
  readonly accountId: string;
  readonly homeDir: string | null;
  started: boolean;
  /** agy showed its sign-in screen on this login: it never starts until someone signs it in. */
  needsSignIn: boolean;
  /** Settles when `needsSignIn` becomes true. */
  readonly signIn: Promise<void>;
  readonly markSignIn: () => void;
  fields: AgyStateFields | null;
  /** The notices already on screen when agy first showed its input box are the conversation's history, not new. */
  seeded: boolean;
  seenNotices: Set<string>;
  /** agy's quota notice appeared on screen since this process started, and nothing was typed since. */
  latch: Readonly<{ atMs: number; inputAt: number; modelId: string | null; conversationId: string | null }> | null;
};

export type AgyChildHooks = Readonly<{
  /** Each new state agy writes. */
  onState: (fields: AgyStateFields) => void;
  /** agy showed its first state past initializing. */
  onStarted: () => void;
  /** agy showed its sign-in screen on a login other than the default one. */
  onAuthenticating: () => void;
}>;

/** What to start agy on, built by the provider (the launch plan is the one owner of agy's command line). */
export type AgyChildPlan = Readonly<{
  accountId: string;
  accountHomeDir: string | null;
  conversationId: string | null;
  /** Typed into agy as the first prompt of the reopened conversation: the continuation after a limit. */
  firstPrompt: string | null;
  childEpoch: number;
  hooks: AgyChildHooks;
}>;

type PendingRequest = Readonly<{ request: AgyAccountSwitchRequestV1; continuationPrompt: string | null }>;

type Verdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; waitingFor: NonNullable<AgyAccountSwitchStateV1['waitingFor']> }>
  | Readonly<{ ok: false; needsConfirmation: true }>;

type BannerBase = Omit<AgyAccountSwitchStateV1, 'v' | 'updatedAtMs' | 'sudoUnavailable'>;

export type AgySessionSwitcher = Readonly<{
  switcher: NativeTerminalCliSwitcher;
  /** What the first agy process reports into; later processes are built by `buildChild` with their own. */
  firstChildHooks: AgyChildHooks;
}>;

/**
 * The runner's side of moving a running agy session to another login (plan r19, UA3). The daemon decides: this
 * reports what agy shows (its conversation and model, a quota notice on screen, whether it is idle) and does
 * what the daemon asks, only when it is safe: agy idle with nothing running in the background (unless the user
 * confirmed that), nothing typed recently or sitting in the input box, and the conversation known. Right before
 * stopping agy it asks the daemon again whether the request still stands. A login that does not start goes
 * into cooldown and the source login starts again on the same conversation; the app's banner is
 * `agyAccountSwitchV1` in the session metadata.
 */
export function createAgySessionSwitcher(params: Readonly<{
  runnerKey: string;
  /** The model the session was started with, until agy says which it shows. */
  launchModelId: string | null;
  initialAccount: Readonly<{ accountId: string; homeDir: string | null }>;
  /** What the first agy was started to open, kept for starting it again on another login. */
  initialConversationId: string | null;
  initialFirstPrompt: string | null;
  /** Asks the daemon for a login again (the one that needs signing in is left out of its answer). */
  chooseAccount: (modelId: string | null) => Promise<Readonly<{ accountId: string; homeDir: string | null }>>;
  sendToDaemon: (request: AgyAccountSessionRequestV1) => Promise<AgyAccountSessionResponseV1 | Readonly<{ error: string }>>;
  /** The terminal's own pane; null when the runner is not in tmux (then nothing is ever safe to switch). */
  pane: OwnTerminalPane | null;
  buildChild: (plan: AgyChildPlan) => NativeTerminalCliSpec | Promise<NativeTerminalCliSpec>;
  now?: () => number;
  tickMs?: number;
  /** How long a started agy has to show its first state (default: the quota fetch deadline). */
  startupMs?: number;
}>): AgySessionSwitcher {
  const now = params.now ?? Date.now;
  let control: NativeTerminalCliControl | null = null;
  let stopped = false;
  let switching = false;
  let request: PendingRequest | null = null;
  const confirmed = new Set<string>();
  let lastSignals: string | null = null;
  let lastSignalsAt = 0;
  let signalFailure: string | null = null;

  const newChild = (accountId: string, homeDir: string | null, epoch: number): ChildState => {
    let markSignIn: () => void = () => undefined;
    const signIn = new Promise<void>((resolve) => {
      markSignIn = resolve;
    });
    return {
      epoch, accountId, homeDir, started: false, needsSignIn: false, signIn, markSignIn,
      fields: null, seeded: false, seenNotices: new Set(), latch: null,
    };
  };
  let child = newChild(params.initialAccount.accountId, params.initialAccount.homeDir, 1);

  // The app's banner. Writes go one after another; the same banner is not written twice.
  let banner: BannerBase = { state: 'none' };
  let bannerKey: string | null = null;
  let writes: Promise<void> = Promise.resolve();
  const write = (update: (metadata: Metadata) => Metadata): void => {
    const target = control?.session;
    if (!target) return;
    writes = writes
      .then(() => target.updateMetadata(update))
      .catch((error: unknown) => {
        logger.infoFile('[agy-terminal] Could not record the agy login on the session', error instanceof Error ? error.message : String(error));
      });
  };
  const publish = (next: BannerBase): void => {
    banner = next;
    const sudoUnavailable = child.accountId !== AGY_DEFAULT_ACCOUNT_ID;
    const key = JSON.stringify({ ...next, sudoUnavailable });
    if (key === bannerKey) return;
    const first = bannerKey === null;
    bannerKey = key;
    // Nothing to say on a session that never left the default login.
    if (first && next.state === 'none' && !sudoUnavailable) return;
    const state: AgyAccountSwitchStateV1 = { v: 1, ...next, ...(sudoUnavailable ? { sudoUnavailable: true } : {}), updatedAtMs: now() };
    write((metadata) => ({ ...metadata, agyAccountSwitchV1: state }));
  };
  const publishCurrent = (): void => publish(banner);

  const hooksFor = (state: ChildState): AgyChildHooks => ({
    onState: (fields) => {
      if (child !== state) return;
      state.fields = fields;
    },
    onStarted: () => {
      if (child !== state) return;
      state.started = true;
      write((metadata) => ({ ...metadata, agyAccountId: state.accountId }));
      publishCurrent();
    },
    onAuthenticating: () => {
      if (child !== state) return;
      state.needsSignIn = true;
      state.markSignIn();
      // A switch in progress sees it through `startOn`; otherwise this is the session's own first agy.
      if (!switching) void recoverFromSignIn(state);
    },
  });

  const modelId = (state: ChildState): string | null => {
    const launch = params.launchModelId?.trim() ?? '';
    return state.fields?.modelId ?? (launch && launch !== 'default' ? launch : null);
  };

  /**
   * The quota notice latch (D5): set by a notice new on screen, cleared by anything typed after it. What is on
   * screen when agy first shows its input box is history (agy shows a reopened conversation's old notice), so it
   * is only remembered; a notice after that is new, even from a turn too short for any state to show it working.
   */
  const updateLatch = (state: ChildState, screen: string | null, lastInputAt: number | null): void => {
    const fields = state.fields;
    if (!fields) return;
    if (screen !== null) {
      const atFirstIdle = !state.seeded && fields.activity?.kind === 'idle';
      for (const notice of readAgyLimitNotices(screen)) {
        if (state.seenNotices.has(notice)) continue;
        state.seenNotices.add(notice);
        if (state.seeded) {
          state.latch = { atMs: now(), inputAt: lastInputAt ?? Math.floor(now() / 1000) * 1000, modelId: fields.modelId, conversationId: fields.conversationId };
        }
      }
      if (atFirstIdle) state.seeded = true;
    }
    const latch = state.latch;
    if (!latch) return;
    // Input strictly after the one seen when the notice appeared (tmux keeps a client's last input to the second).
    const typedSince = lastInputAt !== null && lastInputAt > latch.inputAt;
    if (typedSince || fields.conversationId !== latch.conversationId || fields.modelId !== latch.modelId) state.latch = null;
  };

  const checkSafe = async (pending: PendingRequest): Promise<Verdict> => {
    const fields = child.fields;
    const activity = fields?.activity;
    if (!fields || !activity || activity.kind !== 'idle') return { ok: false, waitingFor: 'idle' };
    if (!fields.conversationId) return { ok: false, waitingFor: 'conversation' };
    const inputAt = control ? await control.readLastInputAt().catch(() => null) : null;
    if (inputAt === null) return { ok: false, waitingFor: 'unknown_input' };
    if (inputAt > 0 && now() - inputAt < INPUT_QUIET_MS) return { ok: false, waitingFor: 'input' };
    const screen = params.pane ? await params.pane.readScreen().catch(() => null) : null;
    // The latch is judged on what was just read, so what a caller does with it next is not stale.
    updateLatch(child, screen, inputAt);
    const box = screen === null ? 'unknown' : readAgyInputBox(screen);
    if (box === 'unknown') return { ok: false, waitingFor: 'unknown_input' };
    if (box === 'draft') return { ok: false, waitingFor: 'draft' };
    if (activity.background === true && !confirmed.has(pending.request.requestId)) return { ok: false, needsConfirmation: true };
    return { ok: true };
  };

  const publishWaiting = (pending: PendingRequest, verdict: Exclude<Verdict, { ok: true }>): void => {
    const common = {
      fromAccountId: child.accountId,
      toAccountId: pending.request.toAccountId,
      reason: pending.request.reason,
    };
    publish('needsConfirmation' in verdict
      ? { state: 'needs_confirmation', ...common, requestId: pending.request.requestId }
      : { state: 'waiting', ...common, waitingFor: verdict.waitingFor });
  };

  const report = async (outcome: Extract<AgyAccountSessionRequestV1, { kind: 'result' }>['outcome'], requestId: string): Promise<void> => {
    await params.sendToDaemon({ kind: 'result', runnerKey: params.runnerKey, requestId, outcome }).catch(() => undefined);
  };

  /** The first state of agy on a login has this long, as a read of a login's limits does (the quota fetch deadline). */
  const startupMs = params.startupMs ?? DEFAULT_CONNECTED_SERVICE_QUOTA_FETCH_TIMEOUT_MS;

  type Started = Readonly<
    | { kind: 'ended' }
    | { kind: 'failed' }
    | { kind: 'running'; started: boolean; needsSignIn: boolean; settle: () => void }
  >;

  /**
   * Starts agy on `accountId` for the conversation; `started` is true when it showed its first state past
   * initializing. A login that sits on the sign-in screen, or has shown nothing for `startupMs`, did not start
   * (`bounded: false` for a login there is nothing to fall back from).
   */
  const startOn = async (
    cli: NativeTerminalCliControl,
    target: Readonly<{ accountId: string; homeDir: string | null }>,
    conversationId: string | null,
    firstPrompt: string | null,
    epoch: number,
    bounded: boolean,
  ): Promise<Started> => {
    const previous = child;
    const state = newChild(target.accountId, target.homeDir, epoch);
    child = state;
    const spec = await params.buildChild({
      accountId: target.accountId,
      accountHomeDir: target.homeDir,
      conversationId,
      firstPrompt,
      childEpoch: epoch,
      hooks: hooksFor(state),
    });
    const result = await cli.replace(spec);
    if (result.kind !== 'running') {
      // Nothing was stopped or started on `failed`: what ran before still does.
      if (result.kind === 'failed') child = previous;
      return { kind: result.kind };
    }
    let timer: NodeJS.Timeout | null = null;
    const deadline = bounded
      ? new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), startupMs);
        timer.unref?.();
      })
      : new Promise<boolean>(() => undefined);
    // A login that needs signing in sits on agy's sign-in screen and never exits: that is a failed start too.
    const started = await Promise.race([result.cli.started, state.signIn.then(() => false), deadline]);
    if (timer) clearTimeout(timer);
    return { kind: 'running', started, needsSignIn: state.needsSignIn, settle: result.cli.settle };
  };

  const reportUnusable = async (accountId: string): Promise<void> => {
    await params.sendToDaemon({ kind: 'login_unusable', runnerKey: params.runnerKey, accountId, reason: 'needs_sign_in' }).catch(() => undefined);
  };

  /**
   * The session's first agy (or one started after a failed one) landed on a login that needs signing in: the
   * daemon leaves that login out, and agy starts again on its next pick, or the default login. A pick that fails
   * to start for any other reason is followed by the default login too.
   */
  const recoverFromSignIn = async (bad: ChildState): Promise<void> => {
    const cli = control;
    if (!cli || switching || stopped) return;
    switching = true;
    let settle: (() => void) | null = null;
    try {
      let failed = bad;
      let pickDefault = false;
      for (;;) {
        if (failed.needsSignIn) await reportUnusable(failed.accountId);
        if (cli.isEnding()) return;
        const picked = pickDefault ? null : await params.chooseAccount(modelId(failed));
        const next = !picked || picked.accountId === failed.accountId
          ? { accountId: AGY_DEFAULT_ACCOUNT_ID, homeDir: null }
          : picked;
        const result = await startOn(cli, next, params.initialConversationId, params.initialFirstPrompt, failed.epoch + 1, next.accountId !== AGY_DEFAULT_ACCOUNT_ID);
        if (result.kind !== 'running') return;
        settle = result.settle;
        if (result.started || next.accountId === AGY_DEFAULT_ACCOUNT_ID) return;
        if (cli.isEnding()) return;
        failed = child;
        pickDefault = !result.needsSignIn;
      }
    } catch (error) {
      logger.infoFile('[agy-terminal] Starting agy on another login failed', error instanceof Error ? error.message : String(error));
    } finally {
      settle?.();
      switching = false;
      lastSignals = null;
    }
  };

  const execute = async (pending: PendingRequest): Promise<void> => {
    const cli = control;
    if (!cli) return;
    switching = true;
    const source = { accountId: child.accountId, homeDir: child.homeDir };
    const sourceEpoch = child.epoch;
    const target = { accountId: pending.request.toAccountId, homeDir: pending.request.toAccountHomeDir };
    const { requestId } = pending.request;
    let settle: (() => void) | null = null;
    try {
      // Last look: the daemon may have changed its mind while agy was busy, and so may agy's screen.
      const confirm = await params.sendToDaemon({ kind: 'confirm', runnerKey: params.runnerKey, requestId });
      if (stopped || 'error' in confirm || !confirm.ok || confirm.valid !== true) {
        request = null;
        return;
      }
      const verdict = await checkSafe(pending);
      if (!verdict.ok) {
        publishWaiting(pending, verdict);
        return;
      }
      const conversationId = child.fields?.conversationId;
      if (!conversationId) return;
      // Only a turn the limit cut off, and nothing typed since, gets the continuation (judged by the look above).
      const cutOff = child.latch !== null;
      const first = await startOn(cli, target, conversationId, cutOff ? pending.continuationPrompt : null, sourceEpoch + 1, true);
      if (first.kind !== 'running') {
        // Stopped by the user, or the replacement could not be prepared: nothing about the target's login.
        request = null;
        await report('abandoned', requestId);
        return;
      }
      settle = first.settle;
      if (!first.started && cli.isEnding()) {
        await report('abandoned', requestId);
        return;
      }
      if (first.started) {
        request = null;
        confirmed.clear();
        publish({ state: 'switched', fromAccountId: source.accountId, toAccountId: target.accountId, reason: pending.request.reason });
        await report('switched', requestId);
        return;
      }
      // The target did not start: its login rests for a while, and the old login starts again on the conversation.
      await report('target_failed', requestId);
      if (first.needsSignIn) await reportUnusable(target.accountId);
      const back = await startOn(cli, source, conversationId, null, sourceEpoch + 2, false);
      if (back.kind === 'ended' || cli.isEnding()) return;
      if (back.kind === 'failed') {
        request = null;
        publish({ state: 'failed', fromAccountId: source.accountId, reason: pending.request.reason, failure: 'source_start_failed' });
        await report('source_failed', requestId);
        return;
      }
      settle = back.settle;
      request = null;
      confirmed.clear();
      if (back.started) {
        publish({
          state: 'failed',
          fromAccountId: source.accountId,
          toAccountId: target.accountId,
          reason: pending.request.reason,
          failure: 'target_start_failed',
        });
      } else {
        publish({ state: 'failed', fromAccountId: source.accountId, reason: pending.request.reason, failure: 'source_start_failed' });
        await report('source_failed', requestId);
      }
    } catch (error) {
      logger.infoFile('[agy-terminal] Switching the agy login failed', error instanceof Error ? error.message : String(error));
    } finally {
      // The session was held for the replacement: from here the CLI that runs (or that failed) is the session's.
      settle?.();
      switching = false;
      lastSignals = null;
    }
  };

  const attempt = async (): Promise<void> => {
    const pending = request;
    if (!pending) return;
    const verdict = await checkSafe(pending);
    if (!verdict.ok) {
      publishWaiting(pending, verdict);
      return;
    }
    await execute(pending);
  };

  /**
   * Types the continuation once, into an empty input box of an idle agy, when the turn was cut off by the limit
   * and nothing was typed since. Everything is read again here: the daemon's answer may have taken seconds.
   */
  const typeContinuation = async (prompt: string): Promise<void> => {
    const state = child;
    const cli = control;
    if (!cli || !params.pane) return;
    const inputAt = await cli.readLastInputAt().catch(() => null);
    const screen = await params.pane.readScreen().catch(() => null);
    if (inputAt === null || screen === null || child !== state || stopped) return;
    updateLatch(state, screen, inputAt);
    const activity = state.fields?.activity;
    if (!state.latch || activity?.kind !== 'idle' || activity.background === true) return;
    if (inputAt > 0 && now() - inputAt < INPUT_QUIET_MS) return;
    if (readAgyInputBox(screen) !== 'empty') return;
    state.latch = null;
    if (!(await params.pane.typeLine(prompt))) logger.infoFile('[agy-terminal] Could not type the continuation into agy');
  };

  const onDecision = async (decision: NonNullable<Extract<AgyAccountSessionResponseV1, { ok: true }>['decision']>): Promise<void> => {
    switch (decision.action) {
      case 'none':
        request = null;
        if (banner.state === 'waiting' || banner.state === 'needs_confirmation' || banner.state === 'all_exhausted') publish({ state: 'none' });
        return;
      case 'recovered':
        request = null;
        publish({ state: 'none' });
        if (decision.continuationPrompt) await typeContinuation(decision.continuationPrompt);
        return;
      case 'all_exhausted':
        request = null;
        publish({ state: 'all_exhausted', fromAccountId: child.accountId, earliestResetAtMs: decision.earliestResetAtMs ?? null });
        return;
      case 'switch':
        if (!decision.request) return;
        if (request?.request.requestId !== decision.request.requestId) confirmed.clear();
        request = { request: decision.request, continuationPrompt: decision.continuationPrompt ?? null };
        await attempt();
        return;
    }
  };

  const tick = async (): Promise<void> => {
    const cli = control;
    const state = child;
    if (!cli || switching || stopped || !state.started || !state.fields || !cli.current().isRunning()) return;
    const lastInputAt = await cli.readLastInputAt().catch(() => null);
    const screen = params.pane ? await params.pane.readScreen().catch(() => null) : null;
    if (stopped || child !== state || switching) return;
    updateLatch(state, screen, lastInputAt);
    const signals: AgyAccountSessionRequestV1 = {
      kind: 'signals',
      runnerKey: params.runnerKey,
      accountId: state.accountId,
      childEpoch: state.epoch,
      modelId: modelId(state),
      conversationId: state.fields.conversationId,
      limitHit: state.latch !== null,
    };
    const key = JSON.stringify(signals);
    if (key === lastSignals && now() - lastSignalsAt < SIGNAL_HEARTBEAT_MS) {
      // Nothing new for the daemon; a request that waits is looked at again.
      if (request) await attempt();
      return;
    }
    lastSignals = key;
    lastSignalsAt = now();
    const response = await params.sendToDaemon(signals);
    if (stopped || child !== state || switching) return;
    if ('error' in response || !response.ok) {
      // Once per run of failures, not once per try.
      const reason = 'error' in response ? response.error : response.errorCode;
      if (signalFailure !== reason) logger.infoFile('[agy-terminal] The daemon did not answer the agy login signals', reason);
      signalFailure = reason;
      return;
    }
    signalFailure = null;
    await onDecision(response.decision ?? { action: 'none' });
  };

  const confirmRpc = async (raw: unknown): Promise<AgyAccountSwitchConfirmResponseV1> => {
    if (!params.pane) return { ok: false, reason: 'not_supported' };
    const parsed = AgyAccountSwitchConfirmRequestV1Schema.safeParse(raw);
    if (!request || !parsed.success) return { ok: false, reason: 'no_request' };
    if (request.request.requestId !== parsed.data.requestId) return { ok: false, reason: 'stale_request' };
    confirmed.add(parsed.data.requestId);
    return { ok: true };
  };

  const switcher: NativeTerminalCliSwitcher = {
    start: (cli) => {
      control = cli;
      cli.session.rpcHandlerManager.registerHandler(AGY_ACCOUNT_SWITCH_CONFIRM_RPC_METHOD, confirmRpc);
      let timer: NodeJS.Timeout | null = null;
      const schedule = (delayMs: number): void => {
        timer = setTimeout(() => {
          void tick()
            .catch((error: unknown) => {
              logger.infoFile('[agy-terminal] Could not look after the agy login', error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
              if (!stopped) schedule(params.tickMs ?? TICK_MS);
            });
        }, delayMs);
        timer.unref?.();
      };
      schedule(params.tickMs ?? TICK_MS);
      return async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        // The daemon forgets this session's request and its claim. Not waited for: a stop must not depend on it.
        void params.sendToDaemon({ kind: 'ended', runnerKey: params.runnerKey }).catch(() => undefined);
        // An exchange with the daemon that is still on its way is not waited for either; it sees `stopped`.
        await writes;
      };
    },
  };

  return { switcher, firstChildHooks: hooksFor(child) };
}
