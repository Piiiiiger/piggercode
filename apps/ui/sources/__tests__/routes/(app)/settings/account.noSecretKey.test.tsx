import { getServerFetchUrl } from '@/dev/testkit/mocks/serverFetch';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storageStore';
import { profileDefaults } from '@/sync/domains/profiles/profile';
import {
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { createAccountFeaturesResponse, isFeaturesRequest } from './account.testHelpers';
import { installAccountSettingsRouteModuleMocks } from './accountSettingsRouteTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

vi.mock('expo-camera', () => ({
    useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
    CameraView: {
        isModernBarcodeScannerAvailable: false,
        onModernBarcodeScanned: () => ({ remove: () => {} }),
        launchScanner: () => {},
        dismissScanner: async () => {},
    },
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        credentials: { token: 't', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        logout: vi.fn(),
    }),
}));

const modalMocks = vi.hoisted(() => ({
    show: vi.fn(),
    alert: vi.fn(),
    prompt: vi.fn(),
    confirm: vi.fn(),
}));

installAccountSettingsRouteModuleMocks({
    modalModule: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: modalMocks,
        }).module;
    },
});

describe('Settings → Account', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        standardCleanup();
    });

    it('shows no secret key, only the username and password sign-in', async () => {
        storage.getState().applyProfile({ ...profileDefaults, linkedProviders: [], username: null });
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = getServerFetchUrl(input).pathname;
            if (isFeaturesRequest(url)) {
                return {
                    ok: true,
                    json: async () => createAccountFeaturesResponse(),
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        const { default: AccountScreen } = await import('@/app/(app)/settings/account');
        const screen = await renderScreen(<AccountScreen />);

        expect(screen.findByTestId('settings-account-password-item')).toBeTruthy();
        expect(screen.findByTestId('settings-account-secret-key-item')).toBeFalsy();
        expect(screen.findByTestId('settings-account-secret-key-copy')).toBeFalsy();
        expect(screen.findByTestId('settings-account-secret-key-value')).toBeFalsy();
    });
});
