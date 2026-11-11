import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchMount, type PatientMountProbe } from './mountWatchdog';

/** Probes that come back after the given delays (ms; Infinity = never, as on a dead connection). */
function delayedProbes(delays: number[]) {
  const asked: string[] = [];
  const probe = (path: string): PatientMountProbe => {
    asked.push(path);
    const delay = delays.shift() ?? 0;
    const exited = new Promise<void>((resolve) => {
      if (Number.isFinite(delay)) setTimeout(resolve, delay);
    });
    return { exited };
  };
  return { asked, probe };
}

describe('watchMount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves a mount that answers alone, however long it runs', async () => {
    const { asked, probe } = delayedProbes(Array.from({ length: 20 }, () => 0));
    const onDead = vi.fn();
    const onAnswer = vi.fn();
    const watch = watchMount({ path: '/home/u/code', onDead, onAnswer, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 3_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(asked.length).toBe(15);
    expect(onAnswer.mock.calls.length).toBeGreaterThanOrEqual(14);
    expect(onDead).not.toHaveBeenCalled();
    watch.stop();
  });

  it('leaves a slow mount alone: a probe that comes back late still shows it answers', async () => {
    // Each probe takes 2.5 s (a big copy queues requests ahead of it), longer than the interval.
    const { asked, probe } = delayedProbes(Array.from({ length: 20 }, () => 2_500));
    const onDead = vi.fn();
    const watch = watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 3_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onDead).not.toHaveBeenCalled();
    // One probe at a time.
    expect(asked.length).toBeLessThanOrEqual(7);
    expect(asked.length).toBeGreaterThanOrEqual(5);
    watch.stop();
  });

  it('leaves a connection alone while data still moves through it, however long one probe waits behind a big copy', async () => {
    // 2026-11-11: copies of tens of MB queued the probe for over 90 s on a slow link; ending that busy
    // connection failed the copy with "Input/output error".
    const { probe } = delayedProbes([Infinity]);
    let moved = 0;
    const onDead = vi.fn();
    watchMount({ path: '/home/u/code', onDead, probe, progress: () => moved, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 3_000 });
    for (let second = 0; second < 10; second += 1) {
      moved += 64 * 1024;
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(onDead).not.toHaveBeenCalled();

    // The data stops (the computer went to sleep): the connection counts as dead once nothing has moved for long enough.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(onDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('calls onDead once when a probe has not come back for long enough, without piling up probes', async () => {
    const { asked, probe } = delayedProbes([0, Infinity]);
    const onDead = vi.fn();
    watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 3_000 });
    // The first probe comes back at 1 s; the second starts at 2 s and never comes back.
    await vi.advanceTimersByTimeAsync(4_500);
    expect(onDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onDead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(asked).toEqual(['/home/u/code', '/home/u/code']);
  });

  it('does nothing more once stopped', async () => {
    const { asked, probe } = delayedProbes([Infinity]);
    const onDead = vi.fn();
    const watch = watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 2_000 });
    await vi.advanceTimersByTimeAsync(1_500);
    watch.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked.length).toBe(1);
    expect(onDead).not.toHaveBeenCalled();
  });
});
