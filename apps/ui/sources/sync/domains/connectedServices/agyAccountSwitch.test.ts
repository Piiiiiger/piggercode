import { describe, expect, it } from 'vitest';

import { parseAgyAccountSwitchV1, readAgyAccountId, readAgyAccountSwitch } from './agyAccountSwitch';

describe('agy account switch metadata', () => {
    it('reads every field of a full state and ignores fields it does not know', () => {
        expect(parseAgyAccountSwitchV1({
            v: 1,
            state: 'all_exhausted',
            fromAccountId: 'default',
            toAccountId: 'b',
            reason: 'exhausted',
            waitingFor: 'draft',
            earliestResetAtMs: 1_700_000_000_000,
            requestId: 'r1',
            failure: 'target_start_failed',
            sudoUnavailable: true,
            updatedAtMs: 5,
            somethingNew: 'x',
        })).toEqual({
            v: 1,
            state: 'all_exhausted',
            fromAccountId: 'default',
            toAccountId: 'b',
            reason: 'exhausted',
            waitingFor: 'draft',
            earliestResetAtMs: 1_700_000_000_000,
            requestId: 'r1',
            failure: 'target_start_failed',
            sudoUnavailable: true,
            updatedAtMs: 5,
        });
    });

    it('keeps an explicit null reset time', () => {
        expect(parseAgyAccountSwitchV1({ v: 1, state: 'all_exhausted', earliestResetAtMs: null, updatedAtMs: 1 }))
            .toMatchObject({ earliestResetAtMs: null });
    });

    it.each([
        ['nothing', undefined],
        ['a string', 'waiting'],
        ['another version', { v: 2, state: 'waiting', updatedAtMs: 1 }],
        ['an unknown state', { v: 1, state: 'teleporting', updatedAtMs: 1 }],
        ['a missing time', { v: 1, state: 'waiting' }],
        ['a non-finite time', { v: 1, state: 'waiting', updatedAtMs: Number.NaN }],
    ])('reads %s as absent', (_name, raw) => {
        expect(parseAgyAccountSwitchV1(raw)).toBeNull();
    });

    it('reads a state with a malformed field as absent, like an old CLI', () => {
        expect(parseAgyAccountSwitchV1({
            v: 1,
            state: 'waiting',
            updatedAtMs: 1,
            waitingFor: 'someday',
        })).toBeNull();
    });

    it('reads the login id and the state from session metadata, and nothing from an old CLI', () => {
        expect(readAgyAccountId({ agyAccountId: 'b' })).toBe('b');
        expect(readAgyAccountId({ agyAccountId: 3 })).toBeNull();
        expect(readAgyAccountId({})).toBeNull();
        expect(readAgyAccountId(null)).toBeNull();
        expect(readAgyAccountSwitch({})).toBeNull();
        expect(readAgyAccountSwitch({ agyAccountSwitchV1: { v: 1, state: 'none', updatedAtMs: 1 } })).toMatchObject({ state: 'none' });
    });
});
