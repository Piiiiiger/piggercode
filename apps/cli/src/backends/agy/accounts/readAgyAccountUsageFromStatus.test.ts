import { describe, expect, it } from 'vitest';

import { readAgyAccountUsageFromStatus } from './readAgyAccountUsageFromStatus';

/** agy 1.5.15's status payload, with the account replaced. */
const STATUS = {
  cwd: '/work',
  conversation_id: '',
  agent_state: 'idle',
  email: 'someone@example.com',
  plan_tier: 'pro',
  quota: {
    '3p-5h': { remaining_fraction: 1, reset_time: '2026-11-23T17:16:59Z', reset_in_seconds: 17999 },
    '3p-weekly': { remaining_fraction: 1, reset_time: '2026-11-30T12:16:59Z', reset_in_seconds: 604799 },
    'gemini-5h': { remaining_fraction: 0.9862, reset_time: '2026-11-23T17:00:27Z', reset_in_seconds: 17007 },
    'gemini-argon-wtu-weekly': { remaining_fraction: 1, reset_time: '2026-11-30T12:16:59Z', reset_in_seconds: 604799 },
    'gemini-weekly': { remaining_fraction: 0.9889, reset_time: '2026-11-30T12:00:27Z', reset_in_seconds: 603807 },
  },
};

describe('readAgyAccountUsageFromStatus', () => {
  it('reads the account and its five limits, in the order agy shows them', () => {
    expect(readAgyAccountUsageFromStatus(STATUS)).toEqual({
      email: 'someone@example.com',
      planTier: 'pro',
      meters: [
        { meterId: 'gemini-5h', remainingFraction: 0.9862, resetAtMs: Date.parse('2026-11-23T17:00:27Z') },
        { meterId: 'gemini-weekly', remainingFraction: 0.9889, resetAtMs: Date.parse('2026-11-30T12:00:27Z') },
        // Untouched: agy's `/usage` says "Quota available" and names no reset. The Argon weekly limit is read
        // too: an Argon model counts it.
        { meterId: 'gemini-argon-wtu-weekly', remainingFraction: 1, resetAtMs: null },
        { meterId: '3p-5h', remainingFraction: 1, resetAtMs: null },
        { meterId: '3p-weekly', remainingFraction: 1, resetAtMs: null },
      ],
    });
  });

  it('leaves out what does not read and still reports the rest', () => {
    expect(readAgyAccountUsageFromStatus({
      quota: {
        'gemini-5h': { remaining_fraction: 0.5 },
        'gemini-weekly': { remaining_fraction: 1.5, reset_time: '2026-11-30T12:00:27Z' },
        '3p-5h': 'soon',
      },
    })).toEqual({
      email: null,
      planTier: null,
      meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: null }],
    });
  });

  it('is no reading while agy reports no limit', () => {
    expect(readAgyAccountUsageFromStatus({ email: 'someone@example.com' })).toBeNull();
    expect(readAgyAccountUsageFromStatus({ quota: {} })).toBeNull();
    expect(readAgyAccountUsageFromStatus(null)).toBeNull();
  });
});
