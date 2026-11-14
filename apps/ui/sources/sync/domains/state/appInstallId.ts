import Constants from 'expo-constants';
import { randomUUID } from '@/platform/randomUUID';
import { loadAppInstallId, saveAppInstallId } from '@/sync/domains/state/persistence';

/**
 * This app install's stable id: Expo's installation id where the platform has one, otherwise one made once and kept on
 * the device. Analytics groups a device's settings by it, and each install gets its own attach of a session's terminal.
 */
export function getAppInstallId(): string | null {
    const installationId = typeof Constants.installationId === 'string'
        ? Constants.installationId.trim()
        : '';
    if (installationId) return installationId;

    const persistedId = loadAppInstallId();
    if (persistedId) return persistedId;

    const generatedId = randomUUID().trim();
    if (!generatedId) return null;
    saveAppInstallId(generatedId);
    return generatedId;
}
