import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import {
    createActivityNotificationTextModuleMock,
    installActivityNotificationRuntimeCommonModuleMocks,
} from './activityNotificationRuntimeTestHelpers';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';


type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const reactNativeRuntime = vi.hoisted(() => ({
    platformOs: 'ios' as 'web' | 'ios' | 'android',
}));

let isTauriDesktopValue = false;
let activeViewingSessionIdValue: string | null = null;
let localSettingsValue: Partial<LocalSettings> = {
    localNotificationsEnabled: true,
    localNotificationsShowReady: true,
    localNotificationsShowReadyMessageText: true,
    localNotificationsShowPendingPermissionRequests: true,
    localNotificationsShowPendingUserActionRequests: true,
};
let sessionsByIdValue: Record<string, unknown> = {
    'session-1': {
        id: 'session-1',
        metadata: {
            summary: {
                text: 'Ready session',
            },
        },
    },
};

const sendExpoLocalNotification = vi.hoisted(() => vi.fn(async () => 'notif-1'));
const sendTauriLocalNotification = vi.hoisted(() => vi.fn(async () => true));

installActivityNotificationRuntimeCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                get OS() {
                    return reactNativeRuntime.platformOs;
                },
            },
        });
    },
    text: async () => {
        return createActivityNotificationTextModuleMock();
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        const { localSettingsDefaults } = await import('@/sync/domains/settings/localSettings');
        const useLocalSetting = <K extends keyof LocalSettings>(key: K): LocalSettings[K] => {
            return (localSettingsValue[key] ?? localSettingsDefaults[key]) as LocalSettings[K];
        };
        return createStorageModuleStub({
            useLocalSetting,
            storage: {
                getState: () => ({
                    sessions: sessionsByIdValue,
                    localSettings: localSettingsValue,
                }),
            },
        });
    },
});

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerUrl: () => 'https://stack.example.test',
}));

vi.mock('@/sync/domains/session/activeViewingSession', () => ({
    getActiveViewingSessionId: () => activeViewingSessionIdValue,
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => isTauriDesktopValue,
}));

vi.mock('../channels/sendExpoLocalNotification', () => ({
    sendExpoLocalNotification,
}));

vi.mock('../channels/sendTauriLocalNotification', () => ({
    sendTauriLocalNotification,
}));

describe('ActivityLocalNotificationRuntime', () => {
    afterEach(async () => {
        reactNativeRuntime.platformOs = 'ios';
        isTauriDesktopValue = false;
        activeViewingSessionIdValue = null;
        localSettingsValue = {
            localNotificationsEnabled: true,
            localNotificationsShowReady: true,
            localNotificationsShowReadyMessageText: true,
            localNotificationsShowPendingPermissionRequests: true,
            localNotificationsShowPendingUserActionRequests: true,
        };
        sessionsByIdValue = {
            'session-1': {
                id: 'session-1',
                metadata: {
                    summary: {
                        text: 'Ready session',
                    },
                },
            },
        };
        sendExpoLocalNotification.mockClear();
        sendTauriLocalNotification.mockClear();

        const { resetActivityLocalNotificationRuntimeForTests } = await import('./activityLocalNotificationBus');
        resetActivityLocalNotificationRuntimeForTests();
    });

    it('sends ready events to the Expo local notification channel when enabled', async () => {
        const { ActivityLocalNotificationRuntime } = await import('./ActivityLocalNotificationRuntime');
        const { notifyActivityReady } = await import('./activityLocalNotificationBus');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<ActivityLocalNotificationRuntime />)).tree;

        await act(async () => {
            notifyActivityReady('session-1', [
                {
                    kind: 'agent-text',
                    id: 'message-1',
                    createdAt: 1,
                    text: 'Everything is ready.',
                } as any,
            ]);
        });

        expect(sendExpoLocalNotification).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Ready session',
            body: 'Everything is ready.',
            data: expect.objectContaining({ sessionId: 'session-1' }),
        }));
        expect(sendTauriLocalNotification).not.toHaveBeenCalled();

        await act(async () => {
            tree?.unmount();
        });
    });

    it('uses the generic ready body when rich ready previews are disabled locally', async () => {
        const { ActivityLocalNotificationRuntime } = await import('./ActivityLocalNotificationRuntime');
        const { notifyActivityReady } = await import('./activityLocalNotificationBus');

        localSettingsValue = {
            ...localSettingsValue,
            localNotificationsShowReadyMessageText: false,
        };

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<ActivityLocalNotificationRuntime />)).tree;

        await act(async () => {
            notifyActivityReady('session-1', [
                {
                    kind: 'agent-text',
                    id: 'message-1',
                    createdAt: 1,
                    text: 'Everything is ready.',
                } as any,
            ]);
        });

        expect(sendExpoLocalNotification).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Ready session',
            body: 'Turn finished. Open the session to continue.',
        }));

        await act(async () => {
            tree?.unmount();
        });
    });

    it('suppresses same-session notifications while the session is already open', async () => {
        activeViewingSessionIdValue = 'session-1';

        const { ActivityLocalNotificationRuntime } = await import('./ActivityLocalNotificationRuntime');
        const { notifyActivityReady } = await import('./activityLocalNotificationBus');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<ActivityLocalNotificationRuntime />)).tree;

        await act(async () => {
            notifyActivityReady('session-1', []);
        });

        expect(sendExpoLocalNotification).not.toHaveBeenCalled();
        expect(sendTauriLocalNotification).not.toHaveBeenCalled();

        await act(async () => {
            tree?.unmount();
        });
    });

    it('sends same-session Tauri notifications when the desktop window is not active', async () => {
        const globalWithDocument = globalThis as unknown as { document?: unknown };
        const originalDocument = globalWithDocument.document;
        globalWithDocument.document = {
            visibilityState: 'hidden',
            hasFocus: () => false,
        };
        reactNativeRuntime.platformOs = 'web';
        isTauriDesktopValue = true;
        activeViewingSessionIdValue = 'session-1';

        try {
            const { ActivityLocalNotificationRuntime } = await import('./ActivityLocalNotificationRuntime');
            const { notifyActivityReady } = await import('./activityLocalNotificationBus');

            let tree: renderer.ReactTestRenderer | null = null;
            tree = (await renderScreen(<ActivityLocalNotificationRuntime />)).tree;

            await act(async () => {
                notifyActivityReady('session-1', []);
            });

            expect(sendExpoLocalNotification).not.toHaveBeenCalled();
            expect(sendTauriLocalNotification).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Ready session',
            }));

            await act(async () => {
                tree?.unmount();
            });
        } finally {
            globalWithDocument.document = originalDocument;
        }
    });

    it('respects per-topic device-local toggles and routes tauri events to the desktop channel', async () => {
        reactNativeRuntime.platformOs = 'web';
        isTauriDesktopValue = true;
        localSettingsValue = {
            ...localSettingsValue,
            localNotificationsShowReady: false,
        };

        const { ActivityLocalNotificationRuntime } = await import('./ActivityLocalNotificationRuntime');
        const { notifyActivityReady, notifyActivityAgentRequest } = await import('./activityLocalNotificationBus');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<ActivityLocalNotificationRuntime />)).tree;

        await act(async () => {
            notifyActivityReady('session-1', []);
            notifyActivityAgentRequest({
                sessionId: 'session-1',
                requestId: 'req-7',
                requestKind: 'permission',
                toolName: 'Bash',
                toolArgs: { command: 'pwd' },
            });
        });

        expect(sendExpoLocalNotification).not.toHaveBeenCalled();
        expect(sendTauriLocalNotification).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Ready session',
            body: 'Command: pwd',
        }));

        await act(async () => {
            tree?.unmount();
        });
    });

    it('tells the desktop user when a terminal session waits for them, each kind behind its own switch', async () => {
        reactNativeRuntime.platformOs = 'web';
        isTauriDesktopValue = true;
        localSettingsValue = {
            ...localSettingsValue,
            localNotificationsShowPendingUserActionRequests: false,
        };

        const { ActivityLocalNotificationRuntime } = await import('./ActivityLocalNotificationRuntime');
        const { notifyActivityTerminalWait } = await import('./activityLocalNotificationBus');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<ActivityLocalNotificationRuntime />)).tree;

        await act(async () => {
            notifyActivityTerminalWait('session-1', { on: 'permission', since: 1 });
            // Questions are switched off on this device.
            notifyActivityTerminalWait('session-1', { on: 'question', since: 2 });
            // A CLI that quit with an error follows the "finished" switch.
            notifyActivityTerminalWait('session-1', { on: 'exited', exitCode: 3, since: 3 });
        });

        expect(sendExpoLocalNotification).not.toHaveBeenCalled();
        expect(sendTauriLocalNotification.mock.calls).toEqual([
            [{ title: 'Ready session', body: 'notifications.activity.terminalWaitingPermissionBody' }],
            [{ title: 'Ready session', body: 'notifications.activity.terminalExitedBody' }],
        ]);

        localSettingsValue = { ...localSettingsValue, localNotificationsShowReady: false };
        sendTauriLocalNotification.mockClear();
        await act(async () => {
            tree?.update(<ActivityLocalNotificationRuntime />);
        });
        await act(async () => {
            notifyActivityTerminalWait('session-1', { on: 'exited', exitCode: 1, since: 4 });
        });
        expect(sendTauriLocalNotification).not.toHaveBeenCalled();

        await act(async () => {
            tree?.unmount();
        });
    });
});
