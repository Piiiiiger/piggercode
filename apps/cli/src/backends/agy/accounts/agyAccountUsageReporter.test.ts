import type { AgyAccountUsageReportV1 } from '@piggercode/protocol';
import { describe, expect, it, vi } from 'vitest';

import { createAgyAccountUsageReporter } from './agyAccountUsageReporter';

const reading = (remainingFraction: number, resetAtMs = 1_000) => ({
  email: 'someone@example.com',
  planTier: null,
  meters: [{ meterId: 'gemini-5h', remainingFraction, resetAtMs }],
});

const settled = () => new Promise((resolve) => setImmediate(resolve));

describe('createAgyAccountUsageReporter', () => {
  it('sends new numbers at once, and the same numbers again only a minute later', async () => {
    let at = 1_000;
    const sent: AgyAccountUsageReportV1[] = [];
    const report = createAgyAccountUsageReporter({
      send: async (next) => {
        sent.push(next);
        return {};
      },
      now: () => at,
    });

    report(reading(0.9));
    await settled();

    // agy rewrites its state with the same numbers.
    at += 59_000;
    report(reading(0.9));
    await settled();
    expect(sent).toHaveLength(1);

    at += 1_000;
    report(reading(0.9));
    await settled();
    expect(sent.map((next) => next.observedAtMs)).toEqual([1_000, 61_000]);

    at += 1;
    report(reading(0.8));
    await settled();
    expect(sent.at(-1)?.meters[0]?.remainingFraction).toBe(0.8);

    // A new window: the same percentage, another reset.
    at += 1;
    report(reading(0.8, 2_000));
    await settled();
    expect(sent.at(-1)?.meters[0]?.resetAtMs).toBe(2_000);
    expect(sent).toHaveLength(4);
  });

  it('sends one at a time, with the newest of the readings that waited', async () => {
    const answers: Array<() => void> = [];
    const sent: Array<number | undefined> = [];
    const report = createAgyAccountUsageReporter({
      send: (next) => new Promise((resolve) => {
        sent.push(next.meters[0]?.remainingFraction);
        answers.push(() => resolve({}));
      }),
    });

    report(reading(0.9));
    report(reading(0.8));
    report(reading(0.7));
    expect(sent).toEqual([0.9]);

    answers.shift()?.();
    await vi.waitFor(() => expect(sent).toEqual([0.9, 0.7]));
    answers.shift()?.();
    await settled();
    expect(sent).toEqual([0.9, 0.7]);
  });

  it('sends the same numbers again at once after the daemon failed to take them', async () => {
    const send = vi.fn<(next: AgyAccountUsageReportV1) => Promise<{ error?: string }>>()
      .mockRejectedValueOnce(new Error('daemon restarting'))
      .mockResolvedValueOnce({ error: 'No daemon running' })
      .mockResolvedValue({});
    const report = createAgyAccountUsageReporter({ send, now: () => 1_000 });

    for (let tries = 0; tries < 3; tries += 1) {
      report(reading(0.9));
      await settled();
    }
    expect(send).toHaveBeenCalledTimes(3);

    report(reading(0.9));
    await settled();
    expect(send).toHaveBeenCalledTimes(3);
  });
});
