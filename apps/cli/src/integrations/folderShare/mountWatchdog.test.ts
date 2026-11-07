import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchMount } from './mountWatchdog';
import type { MountProbe } from './sharedFolderMounts';

/** Probes that answer from a script: true/false, or 'hold' for a probe a dead connection keeps (never exits). */
function scriptedProbes(script: Array<boolean | 'hold'>) {
  const asked: string[] = [];
  const probe = (path: string): MountProbe => {
    asked.push(path);
    const next = script.shift() ?? false;
    if (next === 'hold') return { answers: Promise.resolve(false), exited: new Promise<void>(() => {}) };
    return { answers: Promise.resolve(next), exited: Promise.resolve() };
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
    const { asked, probe } = scriptedProbes(Array.from({ length: 20 }, () => true));
    const onDead = vi.fn();
    const watch = watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 3_000 });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(asked.length).toBe(15);
    expect(onDead).not.toHaveBeenCalled();
    watch.stop();
  });

  it('starts counting again after any answer', async () => {
    const { probe } = scriptedProbes([false, false, true, false, false, true, false, false, true]);
    const onDead = vi.fn();
    const watch = watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 2_500 });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(onDead).not.toHaveBeenCalled();
    watch.stop();
  });

  it('calls onDead once after a mount has not answered for long enough, without piling up probes', async () => {
    const { asked, probe } = scriptedProbes(['hold']);
    const onDead = vi.fn();
    watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 3_000 });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(onDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onDead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onDead).toHaveBeenCalledTimes(1);
    // The held probe still runs, so no other one was started.
    expect(asked).toEqual(['/home/u/code']);
  });

  it('does nothing more once stopped', async () => {
    const { asked, probe } = scriptedProbes([false, false, false, false, false]);
    const onDead = vi.fn();
    const watch = watchMount({ path: '/home/u/code', onDead, probe, now: () => Date.now(), intervalMs: 1_000, deadAfterMs: 2_000 });
    await vi.advanceTimersByTimeAsync(1_500);
    watch.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(asked.length).toBe(1);
    expect(onDead).not.toHaveBeenCalled();
  });
});
