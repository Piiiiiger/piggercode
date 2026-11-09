import { describe, expect, it } from 'vitest';

import { normalizeRawMessage, type NormalizedMessage } from '../typesRaw';
import { createReducer, reducer, sumModelCallOutputTokensSince } from './reducer';

function claudeAssistant(id: string, createdAt: number, apiMessageId: string, outputTokens: number, text: string): NormalizedMessage {
    const normalized = normalizeRawMessage(id, null, createdAt, {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                uuid: `uuid-${id}`,
                message: {
                    id: apiMessageId,
                    role: 'assistant',
                    model: 'claude-opus',
                    content: [{ type: 'text', text }],
                    usage: { input_tokens: 1000, output_tokens: outputTokens },
                },
            },
        },
    } as any);
    if (!normalized) throw new Error('assistant message did not normalize');
    return normalized;
}

function codexTokenCount(id: string, createdAt: number, lastOutputTokens: number | null): NormalizedMessage {
    const normalized = normalizeRawMessage(id, null, createdAt, {
        role: 'agent',
        content: {
            type: 'codex',
            data: {
                type: 'token_count',
                tokens: { input: 9000, output: 4000, total: 13000 },
                ...(lastOutputTokens === null ? {} : { last: { input: 900, output: lastOutputTokens, total: 900 + lastOutputTokens } }),
                id: `tc-${id}`,
            },
        },
    } as any);
    if (!normalized) throw new Error('token_count did not normalize');
    return normalized;
}

describe('per-turn output tokens', () => {
    it('counts each Claude API call once, at its latest figure', () => {
        const state = createReducer();
        reducer(state, [
            claudeAssistant('m1', 1_000, 'msg_A', 10, 'first block'),
            claudeAssistant('m2', 1_100, 'msg_A', 25, 'second block of the same call'),
            claudeAssistant('m3', 1_200, 'msg_B', 5, 'next call'),
        ]);

        expect(sumModelCallOutputTokensSince(state, 900)).toBe(30);
        expect(sumModelCallOutputTokensSince(state, 1_150)).toBe(5);
    });

    it('adds the per-call usage Codex reports beside its thread totals, not the totals', () => {
        const state = createReducer();
        reducer(state, [codexTokenCount('t1', 1_000, 40), codexTokenCount('t2', 1_500, 60)]);

        expect(sumModelCallOutputTokensSince(state, 900)).toBe(100);
        expect(sumModelCallOutputTokensSince(state, 1_200)).toBe(60);
    });

    it('has no count before a call of the turn reported, nor from reports without per-call usage', () => {
        const state = createReducer();
        reducer(state, [codexTokenCount('t1', 1_000, null)]);

        expect(sumModelCallOutputTokensSince(state, 900)).toBeNull();
        expect(sumModelCallOutputTokensSince(createReducer(), 0)).toBeNull();
    });
});
