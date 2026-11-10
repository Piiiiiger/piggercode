import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import type { TranslationKeyNoParams } from '@/text';

type Translate = (key: TranslationKeyNoParams) => string;

export type SettingsStackScreenDefinition = Readonly<{
    name: string;
    options: NativeStackNavigationOptions;
}>;

type SettingsRouteChromeDefinition = Readonly<{
    name: string;
    titleKey?: TranslationKeyNoParams;
    headerBackTitleKey?: TranslationKeyNoParams;
    headerShown?: boolean;
}>;

const SETTINGS_ROUTE_CHROME_DEFINITIONS: readonly SettingsRouteChromeDefinition[] = [
    { name: 'index', titleKey: 'settings.title', headerBackTitleKey: 'common.home' },
    { name: 'account', titleKey: 'settings.account' },
    { name: 'actions', titleKey: 'common.actions' },
    { name: 'actions/[actionId]', titleKey: 'common.actions' },
    { name: 'add-phone', titleKey: 'settings.addYourPhone' },
    { name: 'appearance', titleKey: 'settings.appearance' },
    { name: 'appearance/themes', titleKey: 'settingsAppearance.themeProfiles.title' },
    { name: 'appearance/themes/[profileId]', titleKey: 'settingsAppearance.themeProfiles.editorTitle' },
    { name: 'appearance/themes/import', titleKey: 'settingsAppearance.themeProfiles.importProfile' },
    { name: 'appearance/themes/export', titleKey: 'settingsAppearance.themeProfiles.exportProfile' },
    { name: 'attachments', titleKey: 'settings.attachments' },
    { name: 'connect/claude', headerShown: false },
    { name: 'connected-services/index', titleKey: 'settings.connectedServices' },
    { name: 'connected-services/[serviceId]', titleKey: 'connectedServices.fallbackName' },
    { name: 'connected-services/group', titleKey: 'connectedServices.detail.groupDetail.routeTitle' },
    { name: 'connected-services/import', titleKey: 'connectedServices.importAccounts.title' },
    { name: 'connected-services/oauth', titleKey: 'connectedServices.detail.addOauthProfileTitle' },
    { name: 'connected-services/profile', titleKey: 'connectedServices.profile.profileId' },
    { name: 'connected-services/provider-state-sharing', titleKey: 'connectedServices.providerStateSharing.title' },
    { name: 'diagnosis', titleKey: 'diagnosis.title' },
    { name: 'features', titleKey: 'settings.features' },
    { name: 'keyboard', titleKey: 'settingsKeyboard.title' },
    { name: 'language', titleKey: 'settingsLanguage.currentLanguage' },
    { name: 'machines', titleKey: 'settings.machines' },
    { name: 'machines/add', titleKey: 'settings.addMachine' },
    { name: 'machines/this-computer', titleKey: 'settings.machineSetupCurrentMachineTitle' },
    { name: 'mcp-server', titleKey: 'settings.mcpServersEditorTitle' },
    { name: 'mcp', titleKey: 'settings.mcpServers' },
    { name: 'memory', titleKey: 'settings.memorySearch' },
    { name: 'notifications', titleKey: 'settings.notifications' },
    { name: 'notifications/push', titleKey: 'settingsNotifications.push.troubleshootTitle' },
    { name: 'password', titleKey: 'passwordLogin.settingsTitle' },
    { name: 'pets', titleKey: 'settingsPets.title' },
    { name: 'profiles', titleKey: 'settingsFeatures.profiles' },
    { name: 'providers/[providerId]', titleKey: 'settingsProviders.title' },
    { name: 'providers/index', titleKey: 'settingsProviders.title' },
    { name: 'secrets', titleKey: 'settings.secrets' },
    { name: 'server', titleKey: 'server.serverConfiguration' },
    { name: 'session', titleKey: 'settings.sessions' },
    { name: 'session/composer', titleKey: 'settingsSession.composer.title' },
    { name: 'session/new-session-wizard', titleKey: 'settingsSession.sessionCreation.wizardDispositionTitle' },
    { name: 'session/permissions', titleKey: 'settingsSession.permissions.title' },
    { name: 'session/provider-limits', titleKey: 'settingsSession.providerLimits.title' },
    { name: 'session/resume', titleKey: 'settingsSession.resume.title' },
    { name: 'session/runtime', titleKey: 'settingsSession.runtime.title' },
    { name: 'source-control', titleKey: 'navigation.sourceControl' },
    { name: 'system-status', titleKey: 'settings.systemStatus' },
    { name: 'usage', titleKey: 'settings.usage' },
    { name: 'updates', titleKey: 'updates.title' },
] as const;

export function getSettingsStackScreenDefinitions(t: Translate): readonly SettingsStackScreenDefinition[] {
    return SETTINGS_ROUTE_CHROME_DEFINITIONS.map((definition) => {
        const options: NativeStackNavigationOptions = {
            headerShown: definition.headerShown ?? true,
            headerBackTitle: t(definition.headerBackTitleKey ?? 'common.back'),
        };
        if (definition.titleKey) {
            options.headerTitle = t(definition.titleKey);
        }
        return {
            name: definition.name,
            options,
        };
    });
}
