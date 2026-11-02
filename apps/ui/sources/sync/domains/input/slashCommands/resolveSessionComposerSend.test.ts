import { describe, expect, it } from 'vitest';

import { resolveSessionComposerSend } from './resolveSessionComposerSend';

describe('resolveSessionComposerSend', () => {
    it('passes through normal input unchanged', () => {
        expect(resolveSessionComposerSend({ input: 'hello', executionRunsEnabled: true })).toEqual({
            kind: 'send',
            text: 'hello',
        });
    });

    it('treats // as an escape hatch that sends a slash command through unchanged', () => {
        expect(resolveSessionComposerSend({ input: '//h.review do it', executionRunsEnabled: true })).toEqual({
            kind: 'send',
            text: '/h.review do it',
        });
    });

    it('returns noop for empty // escape', () => {
        expect(resolveSessionComposerSend({ input: '//', executionRunsEnabled: true })).toEqual({ kind: 'noop' });
        expect(resolveSessionComposerSend({ input: '   //   ', executionRunsEnabled: true })).toEqual({ kind: 'noop' });
    });

    it('does not intercept /clear (it should be forwarded to the daemon as a normal message)', () => {
        expect(resolveSessionComposerSend({ input: '/clear', executionRunsEnabled: true })).toEqual({
            kind: 'send',
            text: '/clear',
        });
    });

    it('intercepts configured template tokens', () => {
        const resolved = resolveSessionComposerSend({
            input: '/foo bar',
            executionRunsEnabled: true,
            promptInvocationsV1: {
                v: 1,
                entries: [
                    {
                        id: 't1',
                        token: '/foo',
                        title: 'Foo template',
                        target: { kind: 'doc', artifactId: 'a1' },
                        behavior: 'insert',
                        allowArgs: true,
                        availableIn: 'global',
                    },
                ],
            },
        });

        expect(resolved).toEqual({
            kind: 'template',
            invocationId: 't1',
            token: '/foo',
            title: 'Foo template',
            targetArtifactId: 'a1',
            behavior: 'insert',
            allowArgs: true,
            rest: 'bar',
        });
    });

    it('preserves insert-on-send behavior for configured template tokens', () => {
        const resolved = resolveSessionComposerSend({
            input: '/foo',
            executionRunsEnabled: true,
            promptInvocationsV1: {
                v: 1,
                entries: [
                    {
                        id: 't1',
                        token: '/foo',
                        title: 'Foo template',
                        target: { kind: 'doc', artifactId: 'a1' },
                        behavior: 'insert_on_send',
                        allowArgs: false,
                        availableIn: 'global',
                    },
                ],
            },
        });

        expect(resolved).toMatchObject({
            kind: 'template',
            invocationId: 't1',
            behavior: 'insert_on_send',
        });
    });

    it('does not intercept templates with args when allowArgs=false', () => {
        const resolved = resolveSessionComposerSend({
            input: '/foo bar',
            executionRunsEnabled: true,
            promptInvocationsV1: {
                v: 1,
                entries: [
                    {
                        id: 't1',
                        token: '/foo',
                        title: 'Foo template',
                        target: { kind: 'doc', artifactId: 'a1' },
                        behavior: 'insert',
                        allowArgs: false,
                        availableIn: 'global',
                    },
                ],
            },
        });

        expect(resolved).toEqual({
            kind: 'send',
            text: '/foo bar',
        });
    });

    it('intercepts /h.review into a review.start action when enabled', () => {
        expect(resolveSessionComposerSend({ input: '/h.review review this', executionRunsEnabled: true })).toEqual({
            kind: 'action',
            actionId: 'review.start',
            rest: 'review this',
        });
    });

    it('intercepts /review into a review.start action when enabled', () => {
        expect(resolveSessionComposerSend({ input: '/review review this', executionRunsEnabled: true })).toEqual({
            kind: 'action',
            actionId: 'review.start',
            rest: 'review this',
        });
    });

    it('intercepts /h.voice.reset as a client-only action', () => {
        expect(resolveSessionComposerSend({ input: '/h.voice.reset', executionRunsEnabled: true })).toEqual({
            kind: 'action',
            actionId: 'ui.voice_global.reset',
            rest: '',
        });
    });

    it('intercepts /h.runs as a client-only action', () => {
        expect(resolveSessionComposerSend({ input: '/h.runs', executionRunsEnabled: true })).toEqual({
            kind: 'action',
            actionId: 'execution.run.list',
            rest: '',
        });
    });

    it('intercepts /pet as a client-only action regardless of execution-run enablement', () => {
        expect(resolveSessionComposerSend({ input: '/pet', executionRunsEnabled: false })).toEqual({
            kind: 'action',
            actionId: 'ui.pet.choose',
            rest: '',
        });
    });

    it('intercepts /goal with no objective as a goal UI command', () => {
        expect(resolveSessionComposerSend({ input: '/goal', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'open',
        });
    });

    it('intercepts /goal objective text as a native set-goal command', () => {
        expect(resolveSessionComposerSend({ input: '/goal migrate plugin support', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'set',
            objective: 'migrate plugin support',
        });
    });

    it('passes /goal through to the provider when the session runtime exposes no goal controls', () => {
        expect(resolveSessionComposerSend({
            input: '/goal clear',
            executionRunsEnabled: true,
            goalControlsAvailable: false,
        })).toEqual({
            kind: 'send',
            text: '/goal clear',
        });
    });

    it('fails closed when a caller omits goal-control availability', () => {
        expect(resolveSessionComposerSend({
            input: '/goal ship the parser refactor',
            executionRunsEnabled: true,
        })).toEqual({
            kind: 'send',
            text: '/goal ship the parser refactor',
        });
    });

    it('preserves multiline /goal objective text as a native set-goal command', () => {
        expect(resolveSessionComposerSend({
            input: '/goal line one\nline two',
            executionRunsEnabled: true,
            goalControlsAvailable: true,
        })).toEqual({
            kind: 'goal',
            command: 'set',
            objective: 'line one\nline two',
        });
    });

    it('intercepts /goal control verbs as native goal commands', () => {
        expect(resolveSessionComposerSend({ input: '/goal pause', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'pause',
        });
        expect(resolveSessionComposerSend({ input: '/goal resume', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'resume',
        });
        expect(resolveSessionComposerSend({ input: '/goal complete', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'complete',
        });
        expect(resolveSessionComposerSend({ input: '/goal clear', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'clear',
        });
        expect(resolveSessionComposerSend({ input: '/goal status', executionRunsEnabled: true, goalControlsAvailable: true })).toEqual({
            kind: 'goal',
            command: 'status',
        });
    });

    it('does not intercept /h.review when disabled (passes through as a normal message)', () => {
        expect(resolveSessionComposerSend({ input: '/h.review review this', executionRunsEnabled: false })).toEqual({
            kind: 'send',
            text: '/h.review review this',
        });
    });

    it('does not intercept /review when disabled (passes through as a normal message)', () => {
        expect(resolveSessionComposerSend({ input: '/review review this', executionRunsEnabled: false })).toEqual({
            kind: 'send',
            text: '/review review this',
        });
    });

    it('ships no built-in commands: /happier-diagnose goes to the agent as typed', () => {
        // PiggerCode dropped upstream's built-in /happier-diagnose prompt (it targets Happier's issue tracker).
        expect(resolveSessionComposerSend({ input: '/happier-diagnose', executionRunsEnabled: true })).toEqual({
            kind: 'send',
            text: '/happier-diagnose',
        });
    });
});
