import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { apiSocket } from '@/sync/api/session/apiSocket';

import { sessionRecordTerminalInput } from './sessionTerminalInput';

function answered(): Response {
    return new Response(JSON.stringify({ success: true, meaningfulActivityAt: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe('sessionRecordTerminalInput', () => {
    // The relay's HTTP end.
    let relayRequest: MockInstance;

    beforeEach(() => {
        relayRequest = vi.spyOn(apiSocket, 'request');
    });

    afterEach(() => {
        relayRequest.mockRestore();
    });

    it('sends one more request for Enters typed while one is on its way, not one per Enter', async () => {
        const answers: Array<() => void> = [];
        relayRequest.mockImplementation(() => new Promise<Response>((resolve) => {
            answers.push(() => resolve(answered()));
        }));

        sessionRecordTerminalInput('session-1');
        await settle();
        sessionRecordTerminalInput('session-1');
        sessionRecordTerminalInput('session-1');
        await settle();
        expect(relayRequest).toHaveBeenCalledTimes(1);

        answers.shift()?.();
        await settle();
        expect(relayRequest).toHaveBeenCalledTimes(2);

        answers.shift()?.();
        await settle();
        expect(relayRequest).toHaveBeenCalledTimes(2);

        // Once nothing is on its way, the next Enter is told at once.
        sessionRecordTerminalInput('session-1');
        await settle();
        expect(relayRequest).toHaveBeenCalledTimes(3);
        answers.shift()?.();
        await settle();
    });

    it('gives up on a request the relay never answers, so later Enters are told again', async () => {
        vi.useFakeTimers();
        try {
            // Like fetch: the request settles only when its signal aborts it.
            relayRequest.mockImplementationOnce((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }));
            relayRequest.mockImplementation(async () => answered());

            sessionRecordTerminalInput('session-2');
            await settle();
            sessionRecordTerminalInput('session-2');
            await settle();
            expect(relayRequest).toHaveBeenCalledTimes(1);

            await vi.runOnlyPendingTimersAsync();
            await settle();

            sessionRecordTerminalInput('session-2');
            await settle();
            expect(relayRequest).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
