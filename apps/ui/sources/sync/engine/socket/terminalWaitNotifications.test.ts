import { afterEach, describe, expect, it } from 'vitest';

import {
    resetActivityLocalNotificationRuntimeForTests,
    subscribeActivityLocalNotifications,
    type ActivityLocalNotificationEvent,
} from '@/activity/notifications/runtime/activityLocalNotificationBus';

import { announceTerminalWaitStart, didPendingRequestsStart } from './terminalWaitNotifications';

afterEach(() => {
    resetActivityLocalNotificationRuntimeForTests();
});

describe('didPendingRequestsStart', () => {
    it('sees a session start waiting when a pending count turns non-zero, from its list row or its session', () => {
        const row = { hasPendingPermissionRequests: false, hasPendingUserActionRequests: false };
        expect(didPendingRequestsStart(row, { pendingPermissionRequestCount: 1 })).toBe(true);
        expect(didPendingRequestsStart(row, { pendingUserActionRequestCount: 1 })).toBe(true);
        expect(didPendingRequestsStart({ ...row, hasPendingPermissionRequests: true }, { pendingPermissionRequestCount: 1 })).toBe(false);
        expect(didPendingRequestsStart({ pendingPermissionRequestCount: 0 }, { pendingPermissionRequestCount: 2 })).toBe(true);
        expect(didPendingRequestsStart({ pendingUserActionRequestCount: 1 }, { pendingUserActionRequestCount: 1 })).toBe(false);
    });

    it('sees nothing new in an update that clears requests or does not carry the counts', () => {
        const waiting = { hasPendingPermissionRequests: true, hasPendingUserActionRequests: false };
        expect(didPendingRequestsStart(waiting, { pendingPermissionRequestCount: 0 })).toBe(false);
        expect(didPendingRequestsStart(waiting, {})).toBe(false);
        expect(didPendingRequestsStart(null, { pendingPermissionRequestCount: 0, pendingUserActionRequestCount: 0 })).toBe(false);
    });
});

describe('announceTerminalWaitStart', () => {
    const update = {
        pendingPermissionRequestCount: 1,
        agentState: { version: 2, value: JSON.stringify({ terminalWaiting: { on: 'permission', since: 5 } }) },
    };

    it('tells the user what a plain terminal session waits for', async () => {
        const events: ActivityLocalNotificationEvent[] = [];
        subscribeActivityLocalNotifications((event) => events.push(event));

        await announceTerminalWaitStart({
            sessionId: 's1',
            previous: { hasPendingPermissionRequests: false },
            update,
            encryptionMode: 'plain',
            sessionEncryption: null,
            shouldContinue: () => true,
        });

        expect(events).toEqual([{ kind: 'terminal-wait', sessionId: 's1', waiting: { on: 'permission', since: 5 } }]);
    });

    it('stays quiet when the app moved to another server or account while it read the update', async () => {
        const events: ActivityLocalNotificationEvent[] = [];
        subscribeActivityLocalNotifications((event) => events.push(event));

        await announceTerminalWaitStart({
            sessionId: 's1',
            previous: { hasPendingPermissionRequests: false },
            update,
            encryptionMode: 'plain',
            sessionEncryption: null,
            shouldContinue: () => false,
        });

        expect(events).toEqual([]);
    });
});
