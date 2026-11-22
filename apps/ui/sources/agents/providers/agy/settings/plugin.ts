import { createNoopProviderSettingsPlugin } from '@/agents/providers/shared/createNoopProviderSettingsPlugin';

/** Antigravity keeps its settings in its own TUI (`/config`); PiggerCode has none for it. */
export const AGY_PROVIDER_SETTINGS_PLUGIN = createNoopProviderSettingsPlugin({
    providerId: 'agy',
    title: { key: 'settingsProviders.plugins.agy.title' },
    icon: { ionName: 'rocket-outline', color: { kind: 'theme', token: 'purple' } },
});
