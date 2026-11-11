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
    logPrefix: '[test-terminal]',
    pushSender: push.sender,
    // An account that never changed its notification settings.
    readAccountSettings: async () => ({ settings: accountSettingsParse({}), settingsSecretsReadKeys: [] }),
  });
  return { server, push, reporter };
}

describe('createNativeTerminalActivityReporter', () => {
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
});
