
import * as React from 'react';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { trackWhatsNewClicked } from '@/track';
import { requestReview } from '@/utils/system/requestReview';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveConfiguredRepositoryUrl } from '@/sync/runtime/appBrand';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import { SettingsCheckForUpdatesItem } from './SettingsCheckForUpdatesItem';

type SettingsBelowFoldSectionsRouter = ReturnType<typeof useRouter>;
type SettingsBelowFoldSectionsTheme = ReturnType<typeof useUnistyles>['theme'];

type SettingsBelowFoldSectionsProps = Readonly<{
    appVersion: string;
    attachmentsUploadsEnabled: boolean;
    connectedServicesEnabled: boolean;
    devModeEnabled: boolean;
    handleVersionClick: () => void;
    mcpServersEnabled: boolean;
    memorySearchEnabled: boolean;
    router: SettingsBelowFoldSectionsRouter;
    showChangelog: boolean;
    showRateUs: boolean;
    sourceControlEnabled: boolean;
    stage: number;
    terminalUseTmux: boolean | null | undefined;
    theme: SettingsBelowFoldSectionsTheme;
    useProfiles: boolean | null | undefined;
}>;

export const SettingsBelowFoldSections = React.memo(function SettingsBelowFoldSections({
    appVersion,
    attachmentsUploadsEnabled,
    connectedServicesEnabled,
    devModeEnabled,
    handleVersionClick,
    mcpServersEnabled,
    memorySearchEnabled,
    router,
    showChangelog,
    showRateUs,
    sourceControlEnabled,
    stage,
    terminalUseTmux,
    theme,
    useProfiles,
}: SettingsBelowFoldSectionsProps) {
    return (
        <>
            {stage >= 1 ? (
                <SettingsAiAndAgentsSection
                    connectedServicesEnabled={connectedServicesEnabled}
                    mcpServersEnabled={mcpServersEnabled}
                    memorySearchEnabled={memorySearchEnabled}
                    router={router}
                    theme={theme}
                    useProfiles={useProfiles}
                />
            ) : null}
            {stage >= 2 ? (
                <SettingsSessionsBehaviorSection
                    router={router}
                    terminalUseTmux={terminalUseTmux}
                    theme={theme}
                />
            ) : null}
            {stage >= 3 ? (
                <>
                    <SettingsFilesAndSourceControlSection
                        attachmentsUploadsEnabled={attachmentsUploadsEnabled}
                        router={router}
                        sourceControlEnabled={sourceControlEnabled}
                        theme={theme}
                    />
                    <SettingsSystemSection router={router} theme={theme} />
                    <SettingsDeveloperSection devModeEnabled={devModeEnabled} router={router} theme={theme} />
                </>
            ) : null}
            {stage >= 4 ? (
                <SettingsAboutSection
                    appVersion={appVersion}
                    handleVersionClick={handleVersionClick}
                    router={router}
                    showChangelog={showChangelog}
                    showRateUs={showRateUs}
                    theme={theme}
                />
            ) : null}
        </>
    );
});

type SettingsAiAndAgentsSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'connectedServicesEnabled'
    | 'mcpServersEnabled'
    | 'memorySearchEnabled'
    | 'router'
    | 'theme'
    | 'useProfiles'
>>;

const SettingsAiAndAgentsSection = React.memo(function SettingsAiAndAgentsSection({
    connectedServicesEnabled,
    mcpServersEnabled,
    memorySearchEnabled,
    router,
    theme,
    useProfiles,
}: SettingsAiAndAgentsSectionProps) {
    return (
        <ItemGroup title={t('settings.aiAndAgents')}>
            <Item
                title={t('settingsProviders.title')}
                subtitle={t('settingsProviders.entrySubtitle')}
                icon={<Icon name="sparkle" size={29} color={theme.colors.accent.orange} />}
                onPress={() => router.push('/settings/providers')}
            />
            {useProfiles && (
                <Item
                    title={t('settings.profiles')}
                    subtitle={t('settings.profilesSubtitle')}
                    icon={<Icon name="person" size={29} color={theme.colors.accent.purple} />}
                    onPress={() => router.push('/settings/profiles')}
                />
            )}
            {connectedServicesEnabled ? (
                <Item
                    title={t('settings.connectedServices')}
                    subtitle={t('settings.connectedServicesSubtitle')}
                    icon={<Icon name="key" size={29} color={theme.colors.accent.blue} />}
                    onPress={() => router.push('/settings/connected-services')}
                />
            ) : null}
            {mcpServersEnabled && (
                <Item
                    testID="settings-mcp-servers-item"
                    title={t('settings.mcpServers')}
                    subtitle={t('settings.mcpServersSubtitle')}
                    icon={<Icon name="puzzle-piece" size={29} color={theme.colors.accent.purple} />}
                    onPress={() => router.push('/settings/mcp')}
                />
            )}
            {memorySearchEnabled ? (
                <Item
                    title={t('settings.memorySearch')}
                    subtitle={t('settings.memorySearchSubtitle')}
                    icon={<Icon name="magnifying-glass" size={29} color={theme.colors.state.success.foreground} />}
                    onPress={() => router.push('/settings/memory')}
                />
            ) : null}
        </ItemGroup>
    );
});

type SettingsSessionsBehaviorSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'router'
    | 'terminalUseTmux'
    | 'theme'
>>;

const SettingsSessionsBehaviorSection = React.memo(function SettingsSessionsBehaviorSection({
    router,
    terminalUseTmux,
    theme,
}: SettingsSessionsBehaviorSectionProps) {
    return (
        <ItemGroup title={t('settings.sessionsBehavior')}>
            <Item
                title={t('settings.sessions')}
                subtitle={terminalUseTmux ? t('settings.sessionSubtitleTmuxEnabled') : t('settings.sessionSubtitleMessageSendingAndTmux')}
                icon={<Icon name="terminal" size={29} color={theme.colors.accent.indigo} />}
                onPress={() => router.push('/settings/session')}
            />
            <Item
                title={t('common.actions')}
                subtitle={t('settings.actionsSubtitle')}
                icon={<Icon name="lightning" size={29} color={theme.colors.accent.orange} />}
                onPress={() => router.push('/settings/actions')}
            />
            <Item
                title={t('settings.permissions')}
                subtitle={t('settings.permissionsSubtitle')}
                icon={<Icon name="shield" size={29} color={theme.colors.accent.indigo} />}
                onPress={() => router.push('/settings/session/permissions')}
            />
        </ItemGroup>
    );
});

type SettingsFilesAndSourceControlSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'attachmentsUploadsEnabled'
    | 'router'
    | 'sourceControlEnabled'
    | 'theme'
>>;

const SettingsFilesAndSourceControlSection = React.memo(function SettingsFilesAndSourceControlSection({
    attachmentsUploadsEnabled,
    router,
    sourceControlEnabled,
    theme,
}: SettingsFilesAndSourceControlSectionProps) {
    return (
        <ItemGroup title={t('settings.filesAndSourceControl')}>
            {sourceControlEnabled ? (
                <Item
                    title={t('settings.filesSourceControl')}
                    subtitle={t('settings.filesSourceControlSubtitle')}
                    icon={<Icon name="git-branch" size={29} color={theme.colors.state.success.foreground} />}
                    onPress={() => router.push('/settings/source-control')}
                />
            ) : null}
            {attachmentsUploadsEnabled ? (
                <Item
                    title={t('settings.attachments')}
                    subtitle={t('settings.attachmentsSubtitle')}
                    icon={<Icon name="paperclip" size={29} color={theme.colors.accent.blue} />}
                    onPress={() => router.push('/settings/attachments')}
                />
            ) : null}
        </ItemGroup>
    );
});

type SettingsSystemSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps, 'router' | 'theme'>>;

const SettingsSystemSection = React.memo(function SettingsSystemSection({ router, theme }: SettingsSystemSectionProps) {
    return (
        <ItemGroup title={t('settings.system')}>
            <Item
                title={t('settings.servers')}
                subtitle={t('settings.serversSubtitle')}
                icon={<Icon name="hard-drives" size={29} color={theme.colors.accent.blue} />}
                onPress={() => router.push('/settings/server')}
            />
            <Item
                testID="settings-system-status-item"
                title={t('settings.systemStatus')}
                subtitle={t('settings.systemStatusSubtitle')}
                icon={<Icon name="pulse" size={29} color={theme.colors.accent.indigo} />}
                onPress={() => router.push('/settings/system-status')}
            />
            <Item
                title={t('settings.notifications')}
                subtitle={t('settings.notificationsSubtitle')}
                icon={<Icon name="bell" size={29} color={theme.colors.accent.blue} />}
                onPress={() => router.push('/settings/notifications')}
            />
        </ItemGroup>
    );
});

type SettingsDeveloperSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'devModeEnabled'
    | 'router'
    | 'theme'
>>;

const SettingsDeveloperSection = React.memo(function SettingsDeveloperSection({
    devModeEnabled,
    router,
    theme,
}: SettingsDeveloperSectionProps) {
    if (!__DEV__ && !devModeEnabled) return null;

    return (
        <ItemGroup title={t('settings.developer')}>
            <Item
                title={t('settings.developerTools')}
                icon={<Icon name="wrench" size={29} color={theme.colors.accent.indigo} />}
                onPress={() => router.push('/(app)/dev')}
            />
        </ItemGroup>
    );
});

/** `owner/repo` for a GitHub link, otherwise the host and path. */
function formatRepositoryLabel(repositoryUrl: string): string {
    const url = new URL(repositoryUrl);
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    return url.hostname === 'github.com' ? path : `${url.hostname}/${path}`;
}

type SettingsAboutSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'appVersion'
    | 'handleVersionClick'
    | 'router'
    | 'showChangelog'
    | 'showRateUs'
    | 'theme'
>>;

const SettingsAboutSection = React.memo(function SettingsAboutSection({
    appVersion,
    handleVersionClick,
    router,
    showChangelog,
    showRateUs,
    theme,
}: SettingsAboutSectionProps) {
    const repositoryUrl = resolveConfiguredRepositoryUrl();
    return (
        // PiggerCode links its own repository instead of upstream's (no issue reports, privacy policy, terms,
        // EULA or description); the changelog and store rating stay off through the production feature policy.
        <ItemGroup title={t('settings.about')}>
            {showChangelog ? (
                <Item
                    title={t('settings.whatsNew')}
                    subtitle={t('settings.whatsNewSubtitle')}
                    icon={<Icon name="sparkle" size={29} color={theme.colors.accent.orange} />}
                    onPress={() => {
                        trackWhatsNewClicked();
                        router.push('/(app)/changelog');
                    }}
                />
            ) : null}
            {showRateUs ? (
                <Item
                    title={t('settings.rateUs')}
                    subtitle={t('settings.rateUsSubtitle')}
                    icon={<Icon name="star" size={29} color={theme.colors.accent.orange} />}
                    onPress={() => {
                        void requestReview();
                    }}
                />
            ) : null}
            {repositoryUrl ? (
                <Item
                    title={t('connectedServices.serviceNames.github')}
                    subtitle={formatRepositoryLabel(repositoryUrl)}
                    icon={<Icon name="github-logo" size={29} color={theme.colors.text.primary} />}
                    onPress={() => {
                        void openExternalUrl(repositoryUrl);
                    }}
                />
            ) : null}
            <SettingsCheckForUpdatesItem />
            <Item
                title={t('common.version')}
                detail={appVersion}
                icon={<Icon name="info" size={29} color={theme.colors.text.secondary} />}
                onPress={handleVersionClick}
                showChevron={false}
            />
        </ItemGroup>
    );
});
