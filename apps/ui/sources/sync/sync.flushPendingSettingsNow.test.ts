import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountSettingsScope } from './domains/settings/scope/accountSettingsScope';
import { loadPendingAccountSettings } from './domains/state/accountSettingsPersistence';

const appStateHandlers = vi.hoisted(() => new Set<(state: string) => void>());
const appStateAddListener = vi.hoisted(() => vi.fn((_event: string, handler: (state: string) => void) => {
    appStateHandlers.add(handler);
    return { remove: vi.fn(() => appStateHandlers.delete(handler)) };
}));
const isTauriDesktopState = vi.hoisted(() => ({ value: false }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                        Platform: { OS: 'web' },
                        AppState: {
                            currentState: 'active',
                            addEventListener: appStateAddListener as any,
                        },
                    }
    );
});

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => isTauriDesktopState.value,
}));

const apiSocketDisconnect = vi.hoisted(() => vi.fn());
const apiSocketConnect = vi.hoisted(() => vi.fn());
vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        onMessage: vi.fn(),
        onError: vi.fn(),
        onReconnected: vi.fn(),
        onStatusChange: vi.fn(() => () => {}),
        onConnectionStateChange: vi.fn(() => () => {}),
        connect: apiSocketConnect,
        disconnect: apiSocketDisconnect,
        initialize: vi.fn(),
        request: vi.fn(async () => new Response('ok', { status: 200 })),
    },
}));

const invalidateAllServerReachabilitySupervisorsMock = vi.hoisted(() => vi.fn(async () => {}));
const stopServerReachabilitySupervisorsMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool')>();
    return {
        ...actual,
        invalidateAllServerReachabilitySupervisors: invalidateAllServerReachabilitySupervisorsMock,
        stopServerReachabilitySupervisors: stopServerReachabilitySupervisorsMock,
    };
});

vi.mock('@/log', () => ({
    log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('sync.flushPendingSettingsNow', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('persists the pending settings of the active account now and starts their server sync', async () => {
        const { sync } = await import('./sync');
        const scope = createAccountSettingsScope('server-flush-test', 'account-flush-test');
        expect(scope).toBeTruthy();
        const invalidate = vi.fn();
        (sync as any).settingsSync = { invalidate };
        (sync as any).pendingSettingsScope = scope;
        (sync as any).pendingSettings = { preferredLanguage: 'zh-Hans' };

        sync.flushPendingSettingsNow();

        expect(loadPendingAccountSettings(scope!)).toEqual({ preferredLanguage: 'zh-Hans' });
        expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('does nothing without an active account scope', async () => {
        const { sync } = await import('./sync');
        const invalidate = vi.fn();
        (sync as any).settingsSync = { invalidate };
        (sync as any).pendingSettingsScope = null;
        (sync as any).pendingSettings = { preferredLanguage: 'zh-Hans' };

        sync.flushPendingSettingsNow();

        expect(invalidate).not.toHaveBeenCalled();
    });
});
