import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

type Globals = Record<string, unknown>;
const globals = globalThis as unknown as Globals;
const UPDATE_CHECKS_ENV = 'EXPO_PUBLIC_PIGGERCODE_DESKTOP_UPDATES_ENABLED';
const originalUpdateChecksEnv = process.env[UPDATE_CHECKS_ENV];
const originalDevFlag = (globalThis as { __DEV__?: boolean }).__DEV__;
const DESKTOP_GLOBALS = ['window', '__TAURI_INTERNALS__', '__TAURI__', 'localStorage'] as const;

/** The Tauri IPC is the boundary: the desktop app's own update check answers through it. */
function installDesktop(invoke: (command: string) => unknown): void {
    const internals = { invoke };
    globals.__TAURI_INTERNALS__ = internals;
    globals.__TAURI__ = { event: { listen: async () => () => {} } };
    globals.window = { __TAURI_INTERNALS__: internals, addEventListener: () => {}, removeEventListener: () => {} };
    const stored = new Map<string, string>();
    globals.localStorage = {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, String(value)),
        removeItem: (key: string) => void stored.delete(key),
        clear: () => stored.clear(),
    };
}

beforeEach(() => {
    vi.resetModules();
    process.env[UPDATE_CHECKS_ENV] = '1';
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

afterEach(async () => {
    const { standardCleanup } = await import('@/dev/testkit');
    standardCleanup();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    for (const key of DESKTOP_GLOBALS) delete globals[key];
    if (originalUpdateChecksEnv === undefined) delete process.env[UPDATE_CHECKS_ENV];
    else process.env[UPDATE_CHECKS_ENV] = originalUpdateChecksEnv;
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDevFlag;
});

describe('the app update owner (desktop)', () => {
    it('asks a failed check again as the explicit check, which every surface shows running until it answers', async () => {
        let answer: 'fail' | 'hold' = 'fail';
        let release: () => void = () => {};
        const fetches = vi.fn();
        installDesktop((command) => {
            if (command !== 'desktop_fetch_update') return undefined;
            fetches();
            if (answer === 'fail') return Promise.reject(new Error('offline'));
            return new Promise((resolve) => {
                release = () => resolve(null);
            });
        });
        const { renderHook } = await import('@/dev/testkit');
        const { useAppUpdateStatus } = await import('./useAppUpdateStatus');
        const { useUpdateCheckInFlight } = await import('./updateCheckInFlight');
        const hook = await renderHook(() => ({ status: useAppUpdateStatus(), checking: useUpdateCheckInFlight() }));

        await act(async () => {
            await hook.getCurrent().status.checkNow();
        });
        await vi.waitFor(() => expect(hook.getCurrent().status.model.item.failure).toMatchObject({ kind: 'appCheck' }));
        expect(hook.getCurrent().status.model.item.action).toMatchObject({ kind: 'run', verb: 'retry' });

        answer = 'hold';
        const fetchesBefore = fetches.mock.calls.length;
        let retried: Promise<void> = Promise.resolve();
        await act(async () => {
            retried = hook.getCurrent().status.run();
        });
        expect(fetches.mock.calls.length).toBe(fetchesBefore + 1);
        expect(hook.getCurrent().checking).toBe(true);

        await act(async () => {
            release();
            await retried;
        });
        expect(hook.getCurrent().checking).toBe(false);
        expect(hook.getCurrent().status.model.item.state).toBe('upToDate');
    });
});
