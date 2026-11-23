import { describe, expect, it, vi } from 'vitest';

import { startConnectedServiceQuotasLoop, type ConnectedServiceQuotasLoopHandle } from './startConnectedServiceQuotasLoop';
import { buildConnectedServiceCredentialRecord, projectProviderAccountUsageSnapshotToConnectedServiceQuotaSnapshotV1, type ProviderAccountUsageSnapshotV1 } from '@piggercode/protocol';
import { invalidateConnectedServiceAccountMode } from '@/cloud/connectedServices/resolveConnectedServiceAccountMode';
import { ConnectedServiceQuotasCoordinator } from './ConnectedServiceQuotasCoordinator';
import { createManagingMachineConnectedServiceManagement } from '../management/connectedServiceManagement.testkit';

describe('startConnectedServiceQuotasLoop', () => {
  it.each([0, 2000])('wakes the existing loop after profile changes and preserves an in-flight wake (jitter %s)', async tickJitterMs => {
    let ticks = 0;
    let release: () => void = () => {};
    // The real coordinator owns discovery; only its clock and account HTTP are controlled.
    const coordinator = new ConnectedServiceQuotasCoordinator({
      management: createManagingMachineConnectedServiceManagement(),
      credentials: { token: 'quota-loop-account', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      quotaFetchers: [], discoveryEnabled: false,
      now: () => { ticks += 1; return 500; },
      randomBytes: length => new Uint8Array(length),
      api: {
        getAccountEncryptionMode: async () => { await new Promise<void>(resolve => { release = resolve; }); return 'plain'; },
        getConnectedServiceQuotaSnapshotSealed: async () => null,
        getConnectedServiceCredentialSealed: async () => null,
      },
    });
    const handle = startConnectedServiceQuotasLoop({
      enabled: true, tickMs: 10000, tickJitterMs,
      coordinator,
      onTickError: () => {},
      setIntervalFn: () => 1, clearIntervalFn: () => {},
      ...(tickJitterMs ? { setTimeoutFn: () => 1, clearTimeoutFn: () => {} } : {}),
    });
    handle?.wake();
    expect(ticks).toBe(1);
    handle?.wake();
    handle?.wake();
    expect(ticks).toBe(1);
    release();
    await vi.waitFor(() => expect(ticks).toBe(2));
    handle?.pause();
    handle?.wake();
    expect(ticks).toBe(2);
    handle?.resume();
    await vi.waitFor(() => expect(ticks).toBe(3));
    await handle?.stop();
    handle?.wake();
    expect(ticks).toBe(3);
  });
  it('finishes a requested refresh only after a round that began after the request, and its write', async () => {
    const order: string[] = [];
    let round = 0;
    let releaseFirstRound: () => void = () => {};
    const coordinator = {
      tickOnce: vi.fn(async () => {
        round += 1;
        const current = round;
        order.push(`start ${current}`);
        if (current === 1) await new Promise<void>((resolve) => { releaseFirstRound = resolve; });
        order.push(`end ${current}`);
      }),
    };
    const handle = startConnectedServiceQuotasLoop({
      enabled: true, tickMs: 10_000, coordinator,
      onTickError: () => {},
      setIntervalFn: () => 1, clearIntervalFn: () => {},
      flushResults: async () => { order.push('written'); return true; },
    });

    handle?.wake();
    const refreshed = handle!.refreshNow();
    releaseFirstRound();

    await expect(refreshed).resolves.toBe(true);
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'written']);
    await handle?.stop();
  });

  it('does not wait for rounds asked for after the refresh', async () => {
    let round = 0;
    let releaseLaterRound: () => void = () => {};
    let handle: ConnectedServiceQuotasLoopHandle | null = null;
    handle = startConnectedServiceQuotasLoop({
      enabled: true, tickMs: 10_000,
      coordinator: {
        tickOnce: async () => {
          round += 1;
          await Promise.resolve();
          if (round === 1) handle?.wake();
          if (round === 2) await new Promise<void>((resolve) => { releaseLaterRound = resolve; });
        },
      },
      onTickError: () => {},
      setIntervalFn: () => 1, clearIntervalFn: () => {},
    });

    await expect(handle!.refreshNow()).resolves.toBe(true);

    expect(round).toBe(2);
    releaseLaterRound();
    await handle?.stop();
  });

  it('reports a refresh it could not run or store', async () => {
    const tickOnce = vi.fn(async () => {});
    const flushResults = vi.fn(async () => false);
    const handle = startConnectedServiceQuotasLoop({
      enabled: true, tickMs: 10_000, coordinator: { tickOnce },
      onTickError: () => {},
      setIntervalFn: () => 1, clearIntervalFn: () => {},
      flushResults,
    });

    await expect(handle!.refreshNow()).resolves.toBe(false);
    expect(tickOnce).toHaveBeenCalledTimes(1);

    handle!.pause();
    await expect(handle!.refreshNow()).resolves.toBe(false);
    expect(tickOnce).toHaveBeenCalledTimes(1);
    expect(flushResults).toHaveBeenCalledTimes(1);
    await handle?.stop();
  });

  it('answers false when the loop stops during the requested round', async () => {
    let releaseRound: () => void = () => {};
    const tickOnce = vi.fn(async () => { await new Promise<void>((resolve) => { releaseRound = resolve; }); });
    const flushResults = vi.fn(async () => true);
    const handle = startConnectedServiceQuotasLoop({
      enabled: true, tickMs: 10_000, coordinator: { tickOnce },
      onTickError: () => {},
      setIntervalFn: () => 1, clearIntervalFn: () => {},
      flushResults,
    });

    const refreshed = handle!.refreshNow();
    const stopped = handle!.stop();
    releaseRound();
    await stopped;

    await expect(refreshed).resolves.toBe(false);
    expect(flushResults).not.toHaveBeenCalled();
  });

  it('answers a queued refresh when the loop pauses before its round can start', async () => {
    let releaseRound: () => void = () => {};
    const tickOnce = vi.fn(async () => { await new Promise<void>((resolve) => { releaseRound = resolve; }); });
    const handle = startConnectedServiceQuotasLoop({
      enabled: true, tickMs: 10_000, coordinator: { tickOnce },
      onTickError: () => {},
      setIntervalFn: () => 1, clearIntervalFn: () => {},
    });

    handle?.wake();
    const refreshed = handle!.refreshNow();
    handle!.pause();
    releaseRound();

    await expect(refreshed).resolves.toBe(false);
    expect(tickOnce).toHaveBeenCalledTimes(1);
    await handle?.stop();
  });

  it('schedules tickOnce when enabled', async () => {
    const coordinator: { tickOnce: () => Promise<void> } = { tickOnce: vi.fn(async () => {}) };

	    let captured: (() => void) = () => {};
	    let cleared = 0;
	    const setIntervalFn = ((fn: () => void) => {
	      captured = fn;
	      return 123;
	    });
    const clearIntervalFn = (() => {
      cleared += 1;
    });

    const handle = startConnectedServiceQuotasLoop({
      enabled: true,
      tickMs: 10,
      coordinator,
      onTickError: vi.fn(),
      setIntervalFn,
      clearIntervalFn,
    });

    expect(handle).not.toBeNull();
    const callback: () => void = captured ?? (() => {
      throw new Error('fixture: expected interval callback');
    });
    callback();
    await Promise.resolve();

    expect(coordinator.tickOnce).toHaveBeenCalledTimes(1);
    handle?.stop();
    expect(cleared).toBe(1);
  });

  it('unrefs the interval handle when supported', () => {
    const coordinator: { tickOnce: () => Promise<void> } = { tickOnce: vi.fn(async () => {}) };
    const unref = vi.fn();
    const setIntervalFn = vi.fn(() => ({ unref }));

    startConnectedServiceQuotasLoop({
      enabled: true,
      tickMs: 10,
      coordinator,
      onTickError: vi.fn(),
      setIntervalFn,
      clearIntervalFn: vi.fn(),
    });

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const handle = startConnectedServiceQuotasLoop({
      enabled: false,
      tickMs: 10,
      coordinator: { tickOnce: vi.fn() },
      onTickError: vi.fn(),
      setIntervalFn: () => 123,
      clearIntervalFn: () => {},
    });
    expect(handle).toBeNull();
  });

  it('pauses ticks until resume()', async () => {
    const coordinator: { tickOnce: () => Promise<void> } = { tickOnce: vi.fn(async () => {}) };

    let captured: (() => void) = () => {};
    const setIntervalFn = ((fn: () => void) => {
      captured = fn;
      return 123;
    });

    const handle = startConnectedServiceQuotasLoop({
      enabled: true,
      tickMs: 10,
      coordinator,
      onTickError: vi.fn(),
      setIntervalFn,
      clearIntervalFn: vi.fn(),
    });

    handle?.pause();
    captured();
    await Promise.resolve();
    expect(coordinator.tickOnce).not.toHaveBeenCalled();

    handle?.resume();
    captured();
    await Promise.resolve();
    expect(coordinator.tickOnce).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight tick to settle when stopped', async () => {
    let releaseTick: () => void = () => {
      throw new Error('fixture: expected tick release callback');
    };
    const coordinator: { tickOnce: () => Promise<void> } = {
      tickOnce: vi.fn(async () => await new Promise<void>((resolve) => {
        releaseTick = resolve;
      })),
    };

    let captured: (() => void) = () => {};
    const handle = startConnectedServiceQuotasLoop({
      enabled: true,
      tickMs: 10,
      coordinator,
      onTickError: vi.fn(),
      setIntervalFn: (fn) => {
        captured = fn;
        return 123;
      },
      clearIntervalFn: vi.fn(),
    });

    captured();
    await Promise.resolve();

    let stopSettled = false;
    const stopPromise = handle?.stop().then(() => {
      stopSettled = true;
    });
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    releaseTick();
    await stopPromise;
    expect(stopSettled).toBe(true);
  });

  it('uses deterministic bounded jitter between scheduled wakeups', async () => {
    const coordinator: { tickOnce: () => Promise<void> } = { tickOnce: vi.fn(async () => {}) };

    const scheduled: Array<Readonly<{ fn: () => void; ms: number; handle: number }>> = [];
    const cleared: number[] = [];
    let nextHandle = 1;
    const handle = startConnectedServiceQuotasLoop({
      enabled: true,
      tickMs: 10_000,
      tickJitterMs: 2_000,
      random: () => 0.5,
      coordinator,
      onTickError: vi.fn(),
      setTimeoutFn: (fn, ms) => {
        const timeoutHandle = nextHandle;
        nextHandle += 1;
        scheduled.push({ fn, ms, handle: timeoutHandle });
        return timeoutHandle;
      },
      clearTimeoutFn: (timeoutHandle) => {
        cleared.push(timeoutHandle as number);
      },
    });

    expect(handle).not.toBeNull();
    expect(scheduled.map((entry) => entry.ms)).toEqual([11_000]);

    scheduled[0]!.fn();
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.tickOnce).toHaveBeenCalledTimes(1);
    expect(scheduled.map((entry) => entry.ms)).toEqual([11_000, 11_000]);

    handle?.stop();
    expect(cleared).toEqual([2]);
  });
});
