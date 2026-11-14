import { accountSettingsParse } from '@piggercode/protocol';
import { describe, expect, it, vi } from 'vitest';

import { createNativeTerminalActivityReporter } from './nativeTerminalActivityReporter';
import { fakePushService, fakeServerSession } from './nativeTerminalSession.testkit';

function setup() {
  const server = fakeServerSession();
  const push = fakePushService();
  void server.session.updateMetadata((metadata) => ({ ...metadata, name: 'Fix the login page' }));
  const reporter = createNativeTerminalActivityReporter({
    session: server.session,
    agentName: 'Claude Code',
    agentId: 'claude',
    logPrefix: '[test-terminal]',
    pushSender: push.sender,
    // An account that never changed its notification settings.
    readAccountSettings: () => ({ settings: accountSettingsParse({}), settingsSecretsReadKeys: [] }),
  });
  return { server, push, reporter };
}

describe('createNativeTerminalActivityReporter', () => {
  it('records each turn on the session, from the first sign of work until the CLI is idle again', async () => {
    const { server, reporter } = setup();

    reporter.report({ kind: 'idle' });
    expect(server.turns).toEqual([]);

    reporter.report({ kind: 'working' });
    reporter.report({ kind: 'waiting', on: 'permission' });
    reporter.report({ kind: 'working' });
    expect(server.turns).toEqual([{ action: 'begin', provider: 'claude' }]);

    // Claude finished, but a shell it started in the background still runs: the turn is over.
    reporter.report({ kind: 'idle', background: true });
    reporter.report({ kind: 'idle' });
    await reporter.flush();
    expect(server.turns).toEqual([
      { action: 'begin', provider: 'claude' },
      { action: 'complete', provider: 'claude' },
    ]);
    expect(server.events).toEqual([{ type: 'ready' }]);
  });

  it('counts the CLI as unused only once its input box shows with nothing running, from the moment that began', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000);
      const { reporter } = setup();
      // Nothing reported yet: what the CLI shows is not known, so it does not count as unused.
      expect(reporter.quietSince()).toBeNull();

      vi.setSystemTime(2_000);
      reporter.report({ kind: 'working' });
      expect(reporter.quietSince()).toBeNull();
      reporter.report({ kind: 'waiting', on: 'question' });
      expect(reporter.quietSince()).toBeNull();
      reporter.report({ kind: 'idle', background: true });
      expect(reporter.quietSince()).toBeNull();

      vi.setSystemTime(3_000);
      reporter.report({ kind: 'idle' });
      vi.setSystemTime(9_000);
      reporter.report({ kind: 'idle' });
      expect(reporter.quietSince()).toBe(3_000);

      // What the CLI shows can no longer be read: it may be working, so it no longer counts as unused,
      // and the next idle it shows starts the count again.
      reporter.report({ kind: 'unknown' });
      expect(reporter.quietSince()).toBeNull();
      vi.setSystemTime(12_000);
      reporter.report({ kind: 'idle' });
      expect(reporter.quietSince()).toBe(12_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells the app and the phone once when a turn ends, not when the CLI starts idle', async () => {
    const { server, push, reporter } = setup();

    reporter.report({ kind: 'idle' });
    await reporter.flush();
    expect(server.events).toEqual([]);

    reporter.report({ kind: 'working' });
    reporter.report({ kind: 'working' });
    reporter.report({ kind: 'idle' });
    reporter.report({ kind: 'idle' });
    await reporter.flush();
    await vi.waitFor(() => expect(push.sent).toHaveLength(1));

    expect(server.events).toEqual([{ type: 'ready' }]);
    expect(push.sent[0]).toMatchObject({ title: 'Fix the login page', data: { sessionId: 'session-1' } });
  });

  it('marks the session as waiting while the CLI asks for permission, without approve buttons on the phone', async () => {
    const { server, push, reporter } = setup();

    reporter.report({ kind: 'working' });
    reporter.report({ kind: 'waiting', on: 'permission' });
    await reporter.flush();
    await vi.waitFor(() => expect(push.sent).toHaveLength(1));

    expect(server.agentState().terminalWaiting).toEqual({ on: 'permission', since: expect.any(Number) });
    expect(push.sent[0]!.title).toBe('Fix the login page');
    expect(push.sent[0]!.body).toBe('Claude Code is waiting for your approval in the terminal');
    // A request id or kind would give the phone notification Allow/Deny buttons nobody can answer.
    expect(push.sent[0]!.data).toEqual({ sessionId: 'session-1' });

    reporter.report({ kind: 'working' });
    await reporter.flush();
    expect(server.agentState().terminalWaiting).toBeNull();
    expect(server.events).toEqual([]);

    reporter.report({ kind: 'waiting', on: 'question' });
    reporter.report({ kind: 'idle' });
    await reporter.flush();
    await vi.waitFor(() => expect(push.sent).toHaveLength(3));
    expect(push.sent[1]!.body).toBe('Claude Code is waiting for your answer in the terminal');
    expect(server.agentState().terminalWaiting).toBeNull();
    expect(server.events).toEqual([{ type: 'ready' }]);
  });

  it('keeps a CLI that quit with an error waiting for the user until its terminal closes, and tells them', async () => {
    const { server, push, reporter } = setup();

    reporter.report({ kind: 'waiting', on: 'permission' });
    await reporter.flush();
    await reporter.cliExited(2);
    await vi.waitFor(() => expect(push.sent).toHaveLength(2));

    expect(server.agentState().terminalWaiting).toEqual({ on: 'exited', exitCode: 2, since: expect.any(Number) });
    expect(push.sent[1]).toEqual({ title: 'Fix the login page', body: 'Claude Code exited with code 2', data: { sessionId: 'session-1' } });

    await reporter.end();
    expect(server.agentState().terminalWaiting).toBeNull();
  });

  it('tells nobody when the user quits the CLI, and leaves no prompt behind', async () => {
    const { server, push, reporter } = setup();

    reporter.report({ kind: 'working' });
    reporter.report({ kind: 'waiting', on: 'question' });
    await reporter.flush();
    await vi.waitFor(() => expect(push.sent).toHaveLength(1));
    await reporter.cliExited(0);
    await reporter.end();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(server.agentState().terminalWaiting).toBeNull();
    expect(server.events).toEqual([]);
    expect(push.sent).toHaveLength(1);
  });

  it('writes a cleared prompt again when the relay did not take it, so a gone prompt never stays on the session', async () => {
    const { server, reporter } = setup();
    reporter.report({ kind: 'waiting', on: 'permission' });
    await reporter.flush();

    // The relay is away for longer than a write waits.
    vi.mocked(server.session.updateAgentState).mockRejectedValueOnce(new Error('relay away'));
    reporter.report({ kind: 'working' });
    await reporter.flush();
    expect(server.agentState().terminalWaiting).toEqual({ on: 'permission', since: expect.any(Number) });

    reporter.report({ kind: 'working' });
    await reporter.flush();
    expect(server.agentState().terminalWaiting).toBeNull();

    // Also when the session ends right after the failed write.
    reporter.report({ kind: 'waiting', on: 'question' });
    await reporter.flush();
    vi.mocked(server.session.updateAgentState).mockRejectedValueOnce(new Error('relay away'));
    reporter.report({ kind: 'idle' });
    await reporter.flush();
    await reporter.end();
    expect(server.agentState().terminalWaiting).toBeNull();
  });

  it('reports a finished turn at once, without waiting for the notification choices', async () => {
    const server = fakeServerSession();
    const push = fakePushService();
    const reporter = createNativeTerminalActivityReporter({
      session: server.session,
      agentName: 'Codex',
      agentId: 'codex',
      logPrefix: '[test-terminal]',
      pushSender: push.sender,
      readAccountSettings: () => null,
    });

    reporter.report({ kind: 'working' });
    reporter.report({ kind: 'idle' });

    expect(server.events).toEqual([{ type: 'ready' }]);
    await vi.waitFor(() => expect(push.sent).toHaveLength(1));
  });

  it('heals a lost clear with the heartbeat while the CLI shows nothing new, and at the end when it failed on its way', async () => {
    const { server, reporter } = setup();
    reporter.report({ kind: 'waiting', on: 'permission' });
    await reporter.flush();
    vi.mocked(server.session.updateAgentState).mockRejectedValueOnce(new Error('relay away'));
    reporter.report({ kind: 'idle' });
    await reporter.flush();
    expect(server.agentState().terminalWaiting).not.toBeNull();

    // Claude stays idle, so no report comes; the runner's heartbeat retries.
    reporter.retryUnsaved();
    await reporter.flush();
    expect(server.agentState().terminalWaiting).toBeNull();

    // The session ends while a clear is still on its way, and that clear fails.
    reporter.report({ kind: 'waiting', on: 'question' });
    await reporter.flush();
    vi.mocked(server.session.updateAgentState).mockRejectedValueOnce(new Error('relay away'));
    reporter.report({ kind: 'idle' });
    await reporter.end();
    expect(server.agentState().terminalWaiting).toBeNull();
  });
});
