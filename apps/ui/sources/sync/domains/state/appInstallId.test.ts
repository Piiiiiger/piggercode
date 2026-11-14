import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    constants: {
        installationId: null as string | null,
    },
    persistence: {
        loadAppInstallId: vi.fn(() => null as string | null),
        saveAppInstallId: vi.fn(),
    },
    randomUUID: vi.fn(() => 'generated-device-id'),
}));

vi.mock('expo-constants', () => ({
    default: mocks.constants,
}));

vi.mock('@/sync/domains/state/persistence', () => ({
    loadAppInstallId: mocks.persistence.loadAppInstallId,
    saveAppInstallId: mocks.persistence.saveAppInstallId,
}));

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: mocks.randomUUID,
}));

import { getAppInstallId } from './appInstallId';

describe('getAppInstallId', () => {
    beforeEach(() => {
        mocks.constants.installationId = null;
        mocks.persistence.loadAppInstallId.mockReset();
        mocks.persistence.saveAppInstallId.mockReset();
        mocks.randomUUID.mockClear();
    });

    it('prefers Expo installationId when available', () => {
        mocks.constants.installationId = ' install-123 ';

        expect(getAppInstallId()).toBe('install-123');
        expect(mocks.persistence.loadAppInstallId).not.toHaveBeenCalled();
        expect(mocks.persistence.saveAppInstallId).not.toHaveBeenCalled();
    });

    it('reuses the persisted install id when Expo installationId is unavailable', () => {
        mocks.persistence.loadAppInstallId.mockReturnValue('persisted-device-id');

        expect(getAppInstallId()).toBe('persisted-device-id');
        expect(mocks.persistence.saveAppInstallId).not.toHaveBeenCalled();
        expect(mocks.randomUUID).not.toHaveBeenCalled();
    });

    it('creates and persists a random install id when no stable id exists yet', () => {
        mocks.persistence.loadAppInstallId.mockReturnValue(null);

        expect(getAppInstallId()).toBe('generated-device-id');
        expect(mocks.persistence.saveAppInstallId).toHaveBeenCalledWith('generated-device-id');
    });
});
