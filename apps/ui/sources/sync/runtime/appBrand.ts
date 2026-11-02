import Constants from 'expo-constants';

/**
 * The brand fields this build sets under `extra.app` (APP_BRAND in appVariantConfig.cjs). They are read
 * on each call rather than once at load, so every reader sees the same values.
 */
export type AppBrandConfig = Readonly<{
    productName?: unknown;
    cliCommandName?: unknown;
    agentIds?: unknown;
    repositoryUrl?: unknown;
}>;

export function readAppBrandConfig(): AppBrandConfig {
    return (Constants.expoConfig?.extra as { app?: AppBrandConfig } | undefined)?.app ?? {};
}

/** The build's source repository (an https URL), or null when it names none. */
export function resolveConfiguredRepositoryUrl(): string | null {
    const raw = readAppBrandConfig().repositoryUrl;
    if (typeof raw !== 'string') return null;
    try {
        const url = new URL(raw.trim());
        return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : null;
    } catch {
        return null;
    }
}
