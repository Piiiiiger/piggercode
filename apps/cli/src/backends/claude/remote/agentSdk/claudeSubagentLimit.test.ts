import { describe, expect, it } from 'vitest';

import { createClaudeSubagentLimitTracker } from './claudeSubagentLimit';

function trackerWith(limit: number | null) {
    const state = { limit, now: 1_000 };
    const tracker = createClaudeSubagentLimitTracker({ getLimit: () => state.limit, nowMs: () => state.now });
    const launch = (toolUseId: string) => tracker.admitToolUse({ toolName: 'Agent', toolInput: {}, toolUseId });
    const ackBackground = (toolUseId: string, agentId: string) => tracker.observeHook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: toolUseId,
        tool_response: { status: 'async_launched', agentId },
    });
    const finishForeground = (toolUseId: string) => tracker.observeHook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Agent',
        tool_use_id: toolUseId,
        tool_response: { status: 'completed', content: [] },
    });
    const stop = (agentId: string) => tracker.observeHook({ hook_event_name: 'SubagentStop', agent_id: agentId });
    return { tracker, state, launch, ackBackground, finishForeground, stop };
}

describe('createClaudeSubagentLimitTracker', () => {
    it('refuses every launch and resume when subagents are off', () => {
        const { tracker, state, launch, ackBackground, stop } = trackerWith(null);
        launch('call-old');
        ackBackground('call-old', 'agent-old');
        stop('agent-old');
        state.limit = 0;
        expect(launch('call-1')).toMatch(/turned off/);
        expect(tracker.admitToolUse({ toolName: 'SendMessage', toolInput: { to: 'agent-old' }, toolUseId: 'call-2' }))
            .toMatch(/turned off/);
        expect(tracker.activeCount()).toBe(0);
    });

    it('counts a foreground subagent for as long as its call runs', () => {
        const { tracker, launch, finishForeground, stop } = trackerWith(1);
        expect(launch('call-1')).toBeNull();
        tracker.observeHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-a' });
        expect(launch('call-2')).toMatch(/at most 1 subagent at a time.*1 is running/);
        stop('agent-a');
        expect(tracker.activeCount()).toBe(1);
        finishForeground('call-1');
        expect(launch('call-2')).toBeNull();
    });

    it('counts a background subagent from its launch until it stops, whatever order the launches settle in', () => {
        const { tracker, launch, ackBackground, stop } = trackerWith(2);
        expect(launch('call-a')).toBeNull();
        expect(launch('call-b')).toBeNull();
        tracker.observeHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-b' });
        ackBackground('call-b', 'agent-b');
        // call-a has not returned yet: it still holds its slot.
        expect(launch('call-c')).toMatch(/at most 2 subagents at a time.*2 are running/);
        ackBackground('call-a', 'agent-a');
        expect(tracker.activeCount()).toBe(2);
        expect(launch('call-c')).not.toBeNull();

        stop('agent-a');
        expect(launch('call-c')).toBeNull();
    });

    it('does not count a background subagent that stopped before its launch was acknowledged', () => {
        const { tracker, launch, ackBackground, stop, state } = trackerWith(1);
        launch('call-a');
        state.now += 10;
        stop('agent-a');
        ackBackground('call-a', 'agent-a');
        expect(tracker.activeCount()).toBe(0);
    });

    it('lets messages reach a running subagent but counts a resume of a finished one', () => {
        const { tracker, launch, ackBackground, stop, state } = trackerWith(1);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        expect(tracker.admitToolUse({ toolName: 'SendMessage', toolInput: { to: 'agent-a' }, toolUseId: 'msg-1' })).toBeNull();
        expect(tracker.activeCount()).toBe(1);

        stop('agent-a');
        state.now += 1_000;
        expect(tracker.admitToolUse({ toolName: 'SendMessage', toolInput: { to: 'agent-a' }, toolUseId: 'msg-2' })).toBeNull();
        expect(launch('call-b')).not.toBeNull();
        tracker.observeHook({
            hook_event_name: 'PostToolUse',
            tool_name: 'SendMessage',
            tool_use_id: 'msg-2',
            tool_input: { to: 'agent-a' },
            tool_response: { success: true, resumedAgentId: 'agent-a' },
        });
        expect(tracker.activeCount()).toBe(1);
        expect(launch('call-b')).not.toBeNull();
        stop('agent-a');
        expect(launch('call-b')).toBeNull();
    });

    it('never blocks messages to the main agent, by name, or to a subagent it does not know has finished', () => {
        const { tracker, launch, ackBackground } = trackerWith(1);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        for (const to of ['main', 'researcher', 'agent-unknown']) {
            expect(tracker.admitToolUse({ toolName: 'SendMessage', toolInput: { to }, toolUseId: `msg-${to}` })).toBeNull();
        }
        expect(tracker.activeCount()).toBe(1);
    });

    it('counts a subagent resumed by a message once, even when it starts before the message returns', () => {
        const { tracker, launch, ackBackground, stop, state } = trackerWith(2);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        stop('agent-a');
        state.now += 1_000;
        expect(tracker.admitToolUse({ toolName: 'SendMessage', toolInput: { to: 'agent-a' }, toolUseId: 'msg-1' })).toBeNull();
        tracker.observeHook({ hook_event_name: 'SubagentStart', agent_id: 'agent-a' });
        expect(tracker.activeCount()).toBe(1);
        tracker.observeHook({
            hook_event_name: 'PostToolUse',
            tool_name: 'SendMessage',
            tool_use_id: 'msg-1',
            tool_input: { to: 'agent-a' },
            tool_response: { success: true, resumedAgentId: 'agent-a' },
        });
        expect(tracker.activeCount()).toBe(1);
    });

    it('keeps a background identity through a vetoed stop, even when silent or acknowledged late', () => {
        const silent = trackerWith(1);
        silent.launch('call-a');
        silent.ackBackground('call-a', 'agent-a');
        silent.state.now += 2 * 60 * 60_000 + 1;
        silent.stop('agent-a');
        silent.tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'bash-1', agent_id: 'agent-a' });
        expect(silent.tracker.activeCount()).toBe(1);

        const late = trackerWith(1);
        late.launch('call-b');
        late.state.now += 10;
        late.stop('agent-b');
        late.ackBackground('call-b', 'agent-b');
        expect(late.tracker.activeCount()).toBe(0);
        late.tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'bash-2', agent_id: 'agent-b' });
        expect(late.tracker.activeCount()).toBe(1);
    });

    it('still recognises a long-silent subagent after many other subagents finished', () => {
        const { tracker, launch, ackBackground, stop, state } = trackerWith(1);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        state.now += 2 * 60 * 60_000 + 1;
        expect(tracker.activeCount()).toBe(0);
        for (let index = 0; index < 300; index += 1) stop(`agent-other-${index}`);
        tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'bash-9', agent_id: 'agent-a' });
        expect(tracker.activeCount()).toBe(1);
    });

    it('keeps counting a background subagent whose stop was vetoed and that kept working', () => {
        const { tracker, launch, ackBackground, stop } = trackerWith(1);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        stop('agent-a');
        tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'bash-1', agent_id: 'agent-a' });
        expect(launch('call-b')).not.toBeNull();
    });

    it('frees the slot of a call that failed, was denied, or belonged to a finished turn', () => {
        const { tracker, launch } = trackerWith(1);
        launch('call-1');
        tracker.observeHook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Task', tool_use_id: 'call-1' });
        expect(launch('call-2')).toBeNull();
        tracker.observeHook({ hook_event_name: 'PermissionDenied', tool_name: 'Agent', tool_use_id: 'call-2' });
        expect(launch('call-3')).toBeNull();
        tracker.observeHook({ hook_event_name: 'Stop' });
        expect(launch('call-4')).toBeNull();
    });

    it('frees a background subagent stopped with TaskStop or reported as stopped by the user', () => {
        const { tracker, launch, ackBackground } = trackerWith(2);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        launch('call-b');
        ackBackground('call-b', 'agent-b');
        tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop', tool_use_id: 'stop-1', tool_input: { task_id: 'agent-a' } });
        tracker.observeHook({
            hook_event_name: 'PostToolUse',
            tool_name: 'SendMessage',
            tool_use_id: 'msg-1',
            tool_input: { to: 'agent-b' },
            tool_response: { success: false, message: "Agent agent-b was stopped by the user and won't be resumed." },
        });
        expect(tracker.activeCount()).toBe(0);
    });

    it('forgets a background subagent only after two silent hours', () => {
        const { tracker, launch, ackBackground, state } = trackerWith(1);
        launch('call-a');
        ackBackground('call-a', 'agent-a');
        state.now += 90 * 60_000;
        tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'bash-1', agent_id: 'agent-a' });
        state.now += 90 * 60_000;
        expect(launch('call-b')).not.toBeNull();
        state.now += 31 * 60_000;
        expect(launch('call-b')).toBeNull();
        tracker.observeHook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Agent', tool_use_id: 'call-b' });

        // It was only silent: its next hook counts it again.
        tracker.observeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'bash-2', agent_id: 'agent-a' });
        expect(launch('call-c')).not.toBeNull();
    });

    it('counts subagents started before a limit was set', () => {
        const { state, launch, ackBackground } = trackerWith(null);
        expect(launch('call-a')).toBeNull();
        ackBackground('call-a', 'agent-a');
        state.limit = 1;
        expect(launch('call-b')).toMatch(/at most 1 subagent at a time.*1 is running/);
    });
});
