import type { AgyAccountSessionRequestV1, AgyAccountSessionResponseV1 } from '@piggercode/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeServerSession } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';
import type { OwnTerminalPane } from '@/terminal/nativeTerminal/ownTerminalPane';
import type { NativeTerminalCliControl, NativeTerminalCliSpec } from '@/terminal/nativeTerminal/runNativeTerminalSession';

import { createAgySessionSwitcher, type AgyChildPlan } from './agyAccountSwitcher';
import type { AgyStateFields } from './agyNativeTerminal';

const ESC = '\u001b';
const RULE = '─'.repeat(100);
const EMPTY_BOX = [`header`, RULE, `${ESC}[94m>${ESC}[39m ${ESC}[90mAuto mode: edits & safe commands auto-approved`, `${ESC}[90m${RULE}`, '? for shortcuts'].join('\n');
const DRAFT_BOX = [`header`, RULE, `${ESC}[94m>${ESC}[39m half a message`, `${ESC}[90m${RULE}`, '? for shortcuts'].join('\n');
const LIMIT_NOTICE = ['⚠ Individual quota reached. Resets in 3h 12m.', 'Error ID: abc-1'];
/** agy prints its notice above the input box. */
const withNotice = (box: string): string => box.replace('header', ['header', ...LIMIT_NOTICE].join('\n'));
const CONTINUE = 'Usage limits are lifted. Continue where you left off.';
const CONVERSATION = '6f1c2a9e-1b2c-4d5e-8f90-0a1b2c3d4e5f';

const IDLE: AgyStateFields = { conversationId: CONVERSATION, modelId: null, activity: { kind: 'idle' }, agentState: 'idle' };
const WORKING: AgyStateFields = { conversationId: CONVERSATION, modelId: null, activity: { kind: 'working' }, agentState: 'working' };

const SWITCH_TO_B: AgyAccountSessionResponseV1 = {
  ok: true,
  decision: {
    action: 'switch',
    request: { requestId: 'r1', toAccountId: 'b', toAccountHomeDir: '/logins/b', reason: 'exhausted' },
    continuationPrompt: CONTINUE,
  },
};

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

/** The runner around the switcher: the session, the terminal's pane, the daemon, and agy processes that start or fail. */
function harness(options: Readonly<{
  account?: string;
  pane?: 'present' | 'none';
  /** Whether each replacement agy shows its first state, in order. */
  startsOk?: readonly boolean[];
  /** What each replacement agy does, in order: starts, never starts, or shows its sign-in screen. */
  outcomes?: ReadonlyArray<'ok' | 'fail' | 'auth' | 'wedged' | 'prep'>;
  /** The login the daemon picks when asked again. */
  next?: Readonly<{ accountId: string; homeDir: string | null }>;
}> = {}) {
  const server = fakeServerSession();
  const clock = { now: 1_800_000_000_000 };
  const requests: AgyAccountSessionRequestV1[] = [];
  const daemon = { signals: { ok: true, decision: { action: 'none' } } as AgyAccountSessionResponseV1, confirmValid: true };
  const screen = { text: EMPTY_BOX };
  const typed: string[] = [];
  const pane: OwnTerminalPane | null = options.pane === 'none' ? null : {
    readScreen: async () => screen.text,
    typeLine: async (text) => {
      typed.push(text);
      return true;
    },
  };
  const input = { lastInputAt: 0 as number | null };
  const ending = { value: false };
  const plans: AgyChildPlan[] = [];
  const settles: Array<ReturnType<typeof vi.fn>> = [];
  let replacements = 0;
  const control: NativeTerminalCliControl = {
    session: server.session,
    current: () => ({ exited: new Promise(() => undefined), started: Promise.resolve(true), isRunning: () => true, settle: () => undefined }),
    replace: vi.fn(async (_spec: NativeTerminalCliSpec) => {
      const plan = plans[plans.length - 1]!;
      const outcome = options.outcomes?.[replacements] ?? ((options.startsOk ?? [true])[replacements] ?? true ? 'ok' : 'fail');
      const ok = outcome === 'ok';
      replacements += 1;
      if (outcome === 'prep') return { kind: 'failed' as const };
      if (outcome === 'auth') plan.hooks.onAuthenticating();
      if (ok) {
        plan.hooks.onStarted();
        plan.hooks.onState(IDLE);
      }
      const settle = vi.fn();
      settles.push(settle);
      return {
        kind: 'running' as const,
        cli: {
          exited: new Promise<number>(() => undefined),
          // On its sign-in screen agy never exits and never shows a ready state.
          started: outcome === 'auth' || outcome === 'wedged' ? new Promise<boolean>(() => undefined) : Promise.resolve(ok),
          isRunning: () => true,
          settle,
        },
      };
    }),
    readLastInputAt: async () => input.lastInputAt,
    isEnding: () => ending.value,
  };
  const { switcher, firstChildHooks } = createAgySessionSwitcher({
    runnerKey: 'runner-1',
    launchModelId: null,
    initialAccount: { accountId: options.account ?? 'default', homeDir: options.account && options.account !== 'default' ? `/logins/${options.account}` : null },
    initialConversationId: 'resume-1',
    initialFirstPrompt: 'first prompt',
    chooseAccount: async () => options.next ?? { accountId: 'default', homeDir: null },
    sendToDaemon: async (request) => {
      requests.push(request);
      if (request.kind === 'signals') return daemon.signals;
      if (request.kind === 'confirm') return { ok: true, valid: daemon.confirmValid };
      // Once told how it went, the daemon has nothing more to ask.
      if (request.kind === 'result') daemon.signals = { ok: true, decision: { action: 'none' } };
      return { ok: true };
    },
    pane,
    buildChild: (plan) => {
      plans.push(plan);
      return { cli: { command: 'agy', args: [] }, env: {}, follow: () => async () => undefined };
    },
    now: () => clock.now,
    tickMs: 5,
    startupMs: 40,
  });
  stops.push(switcher.start(control));
  return {
    server,
    clock,
    requests,
    daemon,
    screen,
    typed,
    input,
    ending,
    plans,
    settles,
    control,
    firstChildHooks,
    /** agy on the first login showed its state. */
    state: (fields: AgyStateFields) => firstChildHooks.onState(fields),
    started: () => firstChildHooks.onStarted(),
    banner: () => server.metadata().agyAccountSwitchV1,
    signals: () => requests.filter((request) => request.kind === 'signals'),
    kinds: () => requests.map((request) => request.kind),
    replaced: () => (control.replace as ReturnType<typeof vi.fn>).mock.calls.length,
  };
}

describe('the agy login on the session', () => {
  it('records the login agy runs on once it started, and says sudo is unavailable on a login other than the default', async () => {
    const onDefault = harness();
    onDefault.started();
    await vi.waitFor(() => expect(onDefault.server.metadata().agyAccountId).toBe('default'));
    expect(onDefault.banner()).toBeUndefined();

    const onB = harness({ account: 'b' });
    expect(onB.server.metadata().agyAccountId).toBeUndefined();
    onB.started();
    await vi.waitFor(() => expect(onB.server.metadata().agyAccountId).toBe('b'));
    expect(onB.banner()).toMatchObject({ v: 1, state: 'none', sudoUnavailable: true });
  });

  it('tells the daemon what agy shows: the login, the process, the conversation and the model it was started with', async () => {
    const h = harness({ account: 'b' });
    h.started();
    h.state(IDLE);
    await vi.waitFor(() => expect(h.signals()).not.toHaveLength(0));
    expect(h.signals()[0]).toEqual({
      kind: 'signals',
      runnerKey: 'runner-1',
      accountId: 'b',
      childEpoch: 1,
      modelId: null,
      conversationId: CONVERSATION,
      limitHit: false,
    });
  });

  it('says nothing to the daemon before agy showed a state it can read', async () => {
    const h = harness();
    h.started();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.requests).toEqual([]);
  });
});

describe('when a switch is safe', () => {
  async function waiting(h: ReturnType<typeof harness>) {
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.banner()).toBeDefined());
  }

  type Harness = ReturnType<typeof harness>;
  it.each<[string, (h: Harness) => void, string]>([
    ['agy is working', (h) => h.state(WORKING), 'idle'],
    ['agy waits for a confirmation', (h) => h.state({ ...IDLE, activity: { kind: 'waiting', on: 'permission' } }), 'idle'],
    ['the conversation is not known', (h) => h.state({ ...IDLE, conversationId: null }), 'conversation'],
    ['someone typed a moment ago', (h) => { h.state(IDLE); h.input.lastInputAt = h.clock.now - 1_000; }, 'input'],
    ['the input box holds a draft', (h) => { h.state(IDLE); h.screen.text = DRAFT_BOX; }, 'draft'],
    ['typing cannot be read', (h) => { h.state(IDLE); h.input.lastInputAt = null; }, 'unknown_input'],
    ['no input box is on screen', (h) => { h.state(IDLE); h.screen.text = 'Run this command?'; }, 'unknown_input'],
  ])('waits, and says what for, when %s', async (_name, arrange, waitingFor) => {
    const h = harness();
    arrange(h);
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'waiting', toAccountId: 'b', reason: 'exhausted', waitingFor }));
    expect(h.replaced()).toBe(0);
  });

  it('does not switch without a pane to read the input box from', async () => {
    const h = harness({ pane: 'none' });
    h.state(IDLE);
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'waiting', waitingFor: 'unknown_input' }));
    expect(h.replaced()).toBe(0);
  });

  it('asks the daemon again right before it stops agy, and stops, starts on the target with the conversation, and says so', async () => {
    const h = harness();
    h.state(IDLE);
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'switched', fromAccountId: 'default', toAccountId: 'b', reason: 'exhausted' }));
    expect(h.kinds().indexOf('confirm')).toBeGreaterThan(h.kinds().indexOf('signals'));
    expect(h.kinds().indexOf('confirm')).toBeLessThan(h.kinds().indexOf('result'));
    expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'switched' });
    expect(h.plans).toHaveLength(1);
    expect(h.plans[0]).toMatchObject({ accountId: 'b', accountHomeDir: '/logins/b', conversationId: CONVERSATION, childEpoch: 2, firstPrompt: null });
    expect(h.replaced()).toBe(1);
    await vi.waitFor(() => expect(h.server.metadata().agyAccountId).toBe('b'));
    expect(h.banner()).toMatchObject({ sudoUnavailable: true });
    expect(h.settles[0]).toHaveBeenCalled();
  });

  it('does not stop agy when the daemon no longer wants the request', async () => {
    const h = harness();
    h.daemon.confirmValid = false;
    h.state(IDLE);
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.kinds()).toContain('confirm'));
    expect(h.replaced()).toBe(0);
  });

  it('waits for a confirmation when background work may be running, and goes on only after the app confirms it', async () => {
    const h = harness();
    h.state({ ...IDLE, activity: { kind: 'idle', background: true } });
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'needs_confirmation', requestId: 'r1', toAccountId: 'b' }));
    expect(h.replaced()).toBe(0);

    const confirm = h.server.handlers.get('agy.accountSwitch.confirm')!;
    expect(await confirm({ requestId: 'older' })).toEqual({ ok: false, reason: 'stale_request' });
    expect(await confirm({ requestId: 'r1' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'switched' }));
    expect(h.replaced()).toBe(1);
  });

  it('keeps a draft in the way even after the app confirmed the background check', async () => {
    const h = harness();
    h.state({ ...IDLE, activity: { kind: 'idle', background: true } });
    h.screen.text = DRAFT_BOX;
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'waiting', waitingFor: 'draft' }));
    expect(await h.server.handlers.get('agy.accountSwitch.confirm')!({ requestId: 'r1' })).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.replaced()).toBe(0);
  });

  it('refuses a confirmation when no request waits, or the runner cannot read the terminal', async () => {
    const h = harness();
    expect(await h.server.handlers.get('agy.accountSwitch.confirm')!({ requestId: 'r1' })).toEqual({ ok: false, reason: 'no_request' });
    const noPane = harness({ pane: 'none' });
    expect(await noPane.server.handlers.get('agy.accountSwitch.confirm')!({ requestId: 'r1' })).toEqual({ ok: false, reason: 'not_supported' });
  });

  it('puts the old login back on the same conversation when the target does not start, and says it failed', async () => {
    const h = harness({ startsOk: [false, true] });
    h.state(IDLE);
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'failed', failure: 'target_start_failed', fromAccountId: 'default', toAccountId: 'b' }));
    expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'target_failed' });
    expect(h.plans.map((plan) => [plan.accountId, plan.conversationId, plan.childEpoch, plan.firstPrompt])).toEqual([
      ['b', CONVERSATION, 2, null],
      ['default', CONVERSATION, 3, null],
    ]);
    await vi.waitFor(() => expect(h.server.metadata().agyAccountId).toBe('default'));
  });

  it('keeps the pane and says agy failed to start when the old login does not start either', async () => {
    const h = harness({ startsOk: [false, false] });
    h.state(IDLE);
    await waiting(h);
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'failed', failure: 'source_start_failed' }));
    expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'source_failed' });
    // The session is handed back to the runner either way: no automatic end here.
    expect(h.settles.at(-1)).toHaveBeenCalled();
  });

  it('reports the request as abandoned when the app stops the session during the switch', async () => {
    const h = harness();
    (h.control.replace as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ kind: 'ended' as const }));
    h.state(IDLE);
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'abandoned' }));
    expect(h.banner()?.state).not.toBe('switched');
  });
});

describe('the continuation after a limit', () => {
  /** agy worked, then its quota notice appeared. */
  async function cutOff(h: ReturnType<typeof harness>) {
    h.started();
    h.state(IDLE);
    await vi.waitFor(() => expect(h.signals()).not.toHaveLength(0));
    h.state(WORKING);
    h.screen.text = withNotice(EMPTY_BOX);
    h.state(IDLE);
    await vi.waitFor(() => expect(h.signals().at(-1)).toMatchObject({ limitHit: true }));
  }

  it('is sent with the relaunch only when the last turn was cut off by the limit', async () => {
    const h = harness();
    await cutOff(h);
    h.daemon.signals = SWITCH_TO_B;
    h.clock.now += 6_000;
    await vi.waitFor(() => expect(h.plans).toHaveLength(1));
    expect(h.plans[0]!.firstPrompt).toBe(CONTINUE);
  });

  it('is not sent when the switch is an early one, with no notice on screen', async () => {
    const h = harness();
    h.started();
    h.state(IDLE);
    h.daemon.signals = { ok: true, decision: { ...(SWITCH_TO_B as { decision: object }).decision, request: { requestId: 'r2', toAccountId: 'b', toAccountHomeDir: '/logins/b', reason: 'low' } } } as AgyAccountSessionResponseV1;
    await vi.waitFor(() => expect(h.plans).toHaveLength(1));
    expect(h.plans[0]!.firstPrompt).toBeNull();
  });

  it('does not take a notice of the conversation\'s history for a new limit', async () => {
    const h = harness();
    // The reopened conversation shows an old notice before agy has run a turn.
    h.screen.text = withNotice(EMPTY_BOX);
    h.started();
    h.state(IDLE);
    await vi.waitFor(() => expect(h.signals()).not.toHaveLength(0));
    h.state(WORKING);
    h.state(IDLE);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.signals().every((request) => request.kind === 'signals' && request.limitHit === false)).toBe(true);
  });

  it('is forgotten once something is typed, and a notice that stays on screen does not come back', async () => {
    const h = harness();
    await cutOff(h);
    h.clock.now += 10_000;
    h.input.lastInputAt = h.clock.now;
    await vi.waitFor(() => expect(h.signals().at(-1)).toMatchObject({ limitHit: false }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.signals().at(-1)).toMatchObject({ limitHit: false });
  });

  it('is forgotten when the conversation changes', async () => {
    const h = harness();
    await cutOff(h);
    h.state({ ...IDLE, conversationId: 'another-conversation' });
    await vi.waitFor(() => expect(h.signals().at(-1)).toMatchObject({ limitHit: false }));
  });

  it('is typed once into the empty input box when the own login recovers first, and not into a draft', async () => {
    const h = harness();
    await cutOff(h);
    h.daemon.signals = { ok: true, decision: { action: 'recovered', continuationPrompt: CONTINUE } };
    h.clock.now += 6_000;
    await vi.waitFor(() => expect(h.typed).toEqual([CONTINUE]));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.typed).toEqual([CONTINUE]);

    const drafted = harness();
    await cutOff(drafted);
    drafted.screen.text = withNotice(DRAFT_BOX);
    drafted.daemon.signals = { ok: true, decision: { action: 'recovered', continuationPrompt: CONTINUE } };
    const before = drafted.signals().length;
    drafted.clock.now += 6_000;
    await vi.waitFor(() => expect(drafted.signals().length).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(drafted.typed).toEqual([]);
  });

  it('is not typed when no turn was cut off', async () => {
    const h = harness();
    h.started();
    h.state(IDLE);
    h.daemon.signals = { ok: true, decision: { action: 'recovered', continuationPrompt: CONTINUE } };
    await vi.waitFor(() => expect(h.signals().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.typed).toEqual([]);
  });
});

describe('the banner when every login is used up', () => {
  it('shows when the first login recovers, and clears when the daemon has nothing to say', async () => {
    const h = harness();
    h.started();
    h.state(IDLE);
    h.daemon.signals = { ok: true, decision: { action: 'all_exhausted', earliestResetAtMs: 1_800_003_600_000 } };
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'all_exhausted', earliestResetAtMs: 1_800_003_600_000 }));
    h.daemon.signals = { ok: true, decision: { action: 'none' } };
    h.clock.now += 6_000;
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'none' }));
  });
});

describe('a login that needs signing in', () => {
  it('counts as a failed target: the old login starts again and the daemon is told the login needs signing in', async () => {
    const h = harness({ outcomes: ['auth', 'ok'] });
    h.state(IDLE);
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'failed', failure: 'target_start_failed', toAccountId: 'b' }));
    expect(h.requests).toContainEqual({ kind: 'login_unusable', runnerKey: 'runner-1', accountId: 'b', reason: 'needs_sign_in' });
    expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'target_failed' });
    expect(h.plans.map((plan) => plan.accountId)).toEqual(['b', 'default']);
    expect(h.settles.at(-1)).toHaveBeenCalled();
  });

  it('starts the first agy again on the daemon\'s next pick, with what the session was opened for', async () => {
    const h = harness({ account: 'b', outcomes: ['ok'], next: { accountId: 'c', homeDir: '/logins/c' } });
    h.firstChildHooks.onAuthenticating();
    await vi.waitFor(() => expect(h.plans).toHaveLength(1));
    expect(h.requests).toContainEqual({ kind: 'login_unusable', runnerKey: 'runner-1', accountId: 'b', reason: 'needs_sign_in' });
    expect(h.plans[0]).toMatchObject({ accountId: 'c', accountHomeDir: '/logins/c', conversationId: 'resume-1', firstPrompt: 'first prompt', childEpoch: 2 });
    await vi.waitFor(() => expect(h.settles[0]).toHaveBeenCalled());
  });

  it('falls back to the default login when the daemon has no other pick, and goes on to the next when that pick needs signing in too', async () => {
    const h = harness({ account: 'b', outcomes: ['auth', 'ok'], next: { accountId: 'c', homeDir: '/logins/c' } });
    h.firstChildHooks.onAuthenticating();
    await vi.waitFor(() => expect(h.plans).toHaveLength(2));
    // `c` needed signing in too and the daemon named it again: the default login is the end of the line.
    expect(h.plans.map((plan) => plan.accountId)).toEqual(['c', 'default']);
  });
});

describe('safety of the switch (review round 1)', () => {
  const HEARTBEAT = 6_000;
  async function cutOffFast(h: ReturnType<typeof harness>) {
    h.started();
    h.state(IDLE);
    await vi.waitFor(() => expect(h.signals()).not.toHaveLength(0));
    // A turn so short that no state ever showed it working.
    h.screen.text = withNotice(EMPTY_BOX);
    await vi.waitFor(() => expect(h.signals().at(-1)).toMatchObject({ limitHit: true }));
  }

  it('takes a notice after a turn too short to be seen working as new, and keeps it when the last input was in the same second', async () => {
    const h = harness();
    h.clock.now = 1_800_000_000_600;
    h.input.lastInputAt = 1_800_000_000_000;
    await cutOffFast(h);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.signals().at(-1)).toMatchObject({ limitHit: true });
  });

  it('does not type the continuation when something was typed while the daemon was answering', async () => {
    const h = harness();
    await cutOffFast(h);
    h.daemon.signals = { ok: true, decision: { action: 'recovered', continuationPrompt: CONTINUE } };
    h.input.lastInputAt = h.clock.now + 5_000;
    h.clock.now += HEARTBEAT;
    await vi.waitFor(() => expect(h.signals().at(-1)).toMatchObject({ limitHit: false }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.typed).toEqual([]);
  });

  it('does not type the continuation while background work runs', async () => {
    const h = harness();
    await cutOffFast(h);
    h.state({ ...IDLE, activity: { kind: 'idle', background: true } });
    h.daemon.signals = { ok: true, decision: { action: 'recovered', continuationPrompt: CONTINUE } };
    const before = h.signals().length;
    h.clock.now += HEARTBEAT;
    await vi.waitFor(() => expect(h.signals().length).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.typed).toEqual([]);
  });

  it('counts a target that shows nothing in time as failed and starts the old login again', async () => {
    const h = harness({ outcomes: ['wedged', 'ok'] });
    h.state(IDLE);
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.banner()).toMatchObject({ state: 'failed', failure: 'target_start_failed' }));
    expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'target_failed' });
    expect(h.plans.map((plan) => plan.accountId)).toEqual(['b', 'default']);
  });

  it('reports a stop during the switch as abandoned, not as a failed login', async () => {
    const h = harness({ outcomes: ['fail'] });
    h.ending.value = true;
    h.state(IDLE);
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'abandoned' }));
    expect(h.requests.some((request) => request.kind === 'result' && request.outcome === 'target_failed')).toBe(false);
    expect(h.plans).toHaveLength(1);
  });

  it('leaves everything as it was, and blames no login, when the replacement cannot be prepared', async () => {
    const h = harness({ outcomes: ['prep'] });
    h.state(IDLE);
    h.daemon.signals = SWITCH_TO_B;
    h.started();
    await vi.waitFor(() => expect(h.requests).toContainEqual({ kind: 'result', runnerKey: 'runner-1', requestId: 'r1', outcome: 'abandoned' }));
    expect(h.plans).toHaveLength(1);
    // The session still counts as running on its own login.
    expect(h.signals().every((request) => request.kind === 'signals' && request.accountId === 'default')).toBe(true);
  });

  it('starts the default login when the pick after a sign-in screen fails for another reason', async () => {
    const h = harness({ account: 'b', outcomes: ['fail', 'ok'], next: { accountId: 'c', homeDir: '/logins/c' } });
    h.firstChildHooks.onAuthenticating();
    await vi.waitFor(() => expect(h.plans).toHaveLength(2));
    expect(h.plans.map((plan) => plan.accountId)).toEqual(['c', 'default']);
  });
});
