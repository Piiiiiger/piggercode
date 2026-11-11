import { describe, expect, it } from 'vitest';

import { didPendingRequestsStart } from './terminalWaitNotifications';

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
