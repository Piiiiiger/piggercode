import { describe, expect, it, vi } from 'vitest';

import { startConnectedServiceQuotasLoop } from './startConnectedServiceQuotasLoop';
import { buildConnectedServiceCredentialRecord, projectProviderAccountUsageSnapshotToConnectedServiceQuotaSnapshotV1, type ProviderAccountUsageSnapshotV1 } from '@piggercode/protocol';
import { invalidateConnectedServiceAccountMode } from '@/cloud/connectedServices/resolveConnectedServiceAccountMode';
import { ConnectedServiceQuotasCoordinator } from './ConnectedServiceQuotasCoordinator';

describe('startConnectedServiceQuotasLoop', () => {
  it.each([0, 2000])('wakes the existing loop after profile changes and preserves an in-flight wake (jitter %s)', async tickJitterMs => {
    let ticks = 0;
    let release: () => void = () => {};
    // The real coordinator owns discovery; only its clock and account HTTP are controlled.
    const coordinator = new ConnectedServiceQuotasCoordinator({
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
