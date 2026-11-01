import React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Modal } from '@/modal';
import { t, type TranslationKey } from '@/text';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { resolveAttachmentsUploadConfig } from '@/components/sessions/attachments/useAttachmentsUploadConfig';

import { SharedFolderMountGuideModal } from './SharedFolderMountGuideModal';

type IoniconName = IconName;

const UPLOAD_LOCATION_OPTIONS: ReadonlyArray<{
    id: 'shared_folder' | 'workspace' | 'os_temp';
    titleKey: TranslationKey;
    subtitleKey: TranslationKey;
    iconName: IoniconName;
}> = [
    {
        id: 'shared_folder',
        titleKey: 'settingsAttachments.uploadLocation.options.sharedFolder.title',
        subtitleKey: 'settingsAttachments.uploadLocation.options.sharedFolder.subtitle',
        iconName: 'folder-open',
    },
    {
        id: 'workspace',
        titleKey: 'settingsAttachments.uploadLocation.options.workspace.title',
        subtitleKey: 'settingsAttachments.uploadLocation.options.workspace.subtitle',
        iconName: 'folder',
    },
    {
        id: 'os_temp',
        titleKey: 'settingsAttachments.uploadLocation.options.osTemp.title',
        subtitleKey: 'settingsAttachments.uploadLocation.options.osTemp.subtitle',
        iconName: 'cloud-arrow-up',
    },
];

const VCS_IGNORE_OPTIONS: ReadonlyArray<{
    id: 'git_info_exclude' | 'gitignore' | 'none';
    titleKey: TranslationKey;
    subtitleKey: TranslationKey;
    iconName: IoniconName;
}> = [
    {
        id: 'git_info_exclude',
        titleKey: 'settingsAttachments.sourceControlIgnore.options.gitInfoExclude.title',
        subtitleKey: 'settingsAttachments.sourceControlIgnore.options.gitInfoExclude.subtitle',
        iconName: 'shield-check',
    },
    {
        id: 'gitignore',
        titleKey: 'settingsAttachments.sourceControlIgnore.options.gitignore.title',
        subtitleKey: 'settingsAttachments.sourceControlIgnore.options.gitignore.subtitle',
        iconName: 'git-branch',
    },
    {
        id: 'none',
        titleKey: 'settingsAttachments.sourceControlIgnore.options.none.title',
        subtitleKey: 'settingsAttachments.sourceControlIgnore.options.none.subtitle',
        iconName: 'warning-circle',
    },
];

function normalizeWorkspaceRelativeDir(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return null;
    const parts = trimmed.split(/[\\/]+/g).filter(Boolean);
    if (parts.some((p) => p === '.' || p === '..')) return null;
    return parts.join('/');
}

/** An absolute path or one starting with `~`; the session's machine resolves `~` to its own home. */
function normalizeSharedFolderPath(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const isHomeRelative = trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\');
    const isAbsolute = trimmed.startsWith('/') || trimmed.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(trimmed);
    if (!isHomeRelative && !isAbsolute) return null;
    if (trimmed.split(/[\\/]+/g).some((p) => p === '.' || p === '..')) return null;
    return trimmed;
}

function openSharedFolderMountGuide(): void {
    Modal.show({
        chrome: { kind: 'card', dimensions: { maxHeightRatio: 0.92 } },
        component: SharedFolderMountGuideModal,
        props: {},
        closeOnBackdrop: true,
    });
}

function parsePositiveInt(input: string, opts: Readonly<{ min: number; max: number }>): number | null {
    const raw = Number(input);
    if (!Number.isFinite(raw)) return null;
    const rounded = Math.floor(raw);
    if (rounded < opts.min || rounded > opts.max) return null;
    return rounded;
}

export const AttachmentsSettingsView = React.memo(function AttachmentsSettingsView() {
    const { theme } = useUnistyles();
    const attachmentsEnabled = useFeatureEnabled('attachments.uploads');

    const [uploadLocation, setUploadLocation] = useSettingMutable('attachmentsUploadsUploadLocation');
    const [sharedFolderPath, setSharedFolderPath] = useSettingMutable('attachmentsUploadsSharedFolderPath');
    const [workspaceRelativeDir, setWorkspaceRelativeDir] = useSettingMutable('attachmentsUploadsWorkspaceRelativeDir');
    const [vcsIgnoreStrategy, setVcsIgnoreStrategy] = useSettingMutable('attachmentsUploadsVcsIgnoreStrategy');
    const [vcsIgnoreWritesEnabled, setVcsIgnoreWritesEnabled] = useSettingMutable('attachmentsUploadsVcsIgnoreWritesEnabled');
    const [maxFileBytes, setMaxFileBytes] = useSettingMutable('attachmentsUploadsMaxFileBytes');

    // Show exactly what uploads will use.
    const effective = resolveAttachmentsUploadConfig({
        uploadLocation,
        sharedFolderPath,
        workspaceRelativeDir,
        vcsIgnoreStrategy,
        vcsIgnoreWritesEnabled,
        maxFileBytes,
    });
    const effectiveUploadLocation = effective.uploadLocation;
    const effectiveIgnoreStrategy = effective.vcsIgnoreStrategy;
    const effectiveWorkspaceRelativeDir = effective.workspaceRelativeDir;
    const effectiveSharedFolderPath = effective.sharedFolderPath ?? '';

    if (!attachmentsEnabled) {
        return (
            <ItemList style={{ paddingTop: 0 }}>
                <ItemGroup
                    title={t('settingsAttachments.disabled.title')}
                    footer={t('settingsAttachments.disabled.footer')}
                >
                    <Item
                        title={t('settingsAttachments.fileUploads.title')}
                        subtitle={t('common.disabled')}
                        icon={<Icon name="paperclip" size={29} color={theme.colors.state.danger.foreground} />}
                        showChevron={false}
                    />
                </ItemGroup>
            </ItemList>
        );
    }

    const renderIcon = (iconName: IoniconName) => (
        <Icon name={iconName} size={29} color={theme.colors.text.secondary} />
    );

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title={t('settingsAttachments.uploadLocation.title')}
                footer={t('settingsAttachments.uploadLocation.footer')}
            >
                {UPLOAD_LOCATION_OPTIONS.map((option) => (
                    <Item
                        key={option.id}
                        title={t(option.titleKey)}
                        subtitle={t(option.subtitleKey)}
                        icon={renderIcon(option.iconName)}
                        rightElement={effectiveUploadLocation === option.id ? <Icon name="check" size={20} color={theme.colors.accent.blue} /> : null}
                        onPress={() => setUploadLocation(option.id)}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>

            {effectiveUploadLocation === 'shared_folder' ? (
                <ItemGroup title={t('settingsAttachments.sharedFolder.title')} footer={t('settingsAttachments.sharedFolder.footer')}>
                    <Item
                        title={t('settingsAttachments.sharedFolder.folder.title')}
                        subtitle={effectiveSharedFolderPath}
                        icon={renderIcon('folder-open')}
                        onPress={async () => {
                            const raw = await Modal.prompt(
                                t('settingsAttachments.sharedFolder.folder.promptTitle'),
                                t('settingsAttachments.sharedFolder.folder.promptMessage'),
                                { placeholder: effectiveSharedFolderPath, defaultValue: effectiveSharedFolderPath },
                            );
                            if (raw === null) return;
                            const normalized = normalizeSharedFolderPath(raw);
                            if (!normalized) {
                                Modal.alert(t('settingsAttachments.sharedFolder.folder.invalidTitle'), t('settingsAttachments.sharedFolder.folder.invalidMessage'));
                                return;
                            }
                            setSharedFolderPath(normalized);
                        }}
                    />
                    <Item
                        testID="settings-attachments-shared-folder-mount-guide"
                        title={t('settingsAttachments.sharedFolder.mountGuide.itemTitle')}
                        subtitle={t('settingsAttachments.sharedFolder.mountGuide.itemSubtitle')}
                        icon={renderIcon('desktop')}
                        onPress={openSharedFolderMountGuide}
                    />
                </ItemGroup>
            ) : null}

            {effectiveUploadLocation === 'workspace' ? (
                <>
                    <ItemGroup title={t('settingsAttachments.workspaceDirectory.title')} footer={t('settingsAttachments.workspaceDirectory.footer')}>
                        <Item
                            title={t('settingsAttachments.workspaceDirectory.uploadsDirectory.title')}
                            subtitle={effectiveWorkspaceRelativeDir}
                            icon={renderIcon('folder')}
                            onPress={async () => {
                                const raw = await Modal.prompt(
                                    t('settingsAttachments.workspaceDirectory.uploadsDirectory.promptTitle'),
                                    t('settingsAttachments.workspaceDirectory.uploadsDirectory.promptMessage'),
                                    { placeholder: effectiveWorkspaceRelativeDir },
                                );
                                if (raw === null) return;
                                const normalized = normalizeWorkspaceRelativeDir(raw);
                                if (!normalized) {
                                    Modal.alert(t('settingsAttachments.workspaceDirectory.uploadsDirectory.invalidDirectoryTitle'), t('settingsAttachments.workspaceDirectory.uploadsDirectory.invalidDirectoryMessage'));
                                    return;
                                }
                                setWorkspaceRelativeDir(normalized);
                            }}
                        />
                    </ItemGroup>

                    <ItemGroup
                        title={t('settingsAttachments.sourceControlIgnore.title')}
                        footer={t('settingsAttachments.sourceControlIgnore.footer')}
                    >
                        {VCS_IGNORE_OPTIONS.map((option) => (
                            <Item
                                key={option.id}
                                title={t(option.titleKey)}
                                subtitle={t(option.subtitleKey)}
                                icon={renderIcon(option.iconName)}
                                rightElement={effectiveIgnoreStrategy === option.id ? <Icon name="check" size={20} color={theme.colors.accent.blue} /> : null}
                                onPress={() => setVcsIgnoreStrategy(option.id)}
                                showChevron={false}
                            />
                        ))}
                        <Item
                            title={t('settingsAttachments.sourceControlIgnore.writeIgnoreRules.title')}
                            subtitle={vcsIgnoreWritesEnabled === false ? t('common.disabled') : t('common.enabled')}
                            icon={renderIcon('pencil-simple')}
                            showChevron={false}
                            onPress={() => setVcsIgnoreWritesEnabled(!(vcsIgnoreWritesEnabled === false))}
                        />
                    </ItemGroup>
                </>
            ) : null}

            <ItemGroup title={t('settingsAttachments.limits.title')} footer={t('settingsAttachments.limits.footer')}>
                <Item
                    title={t('settingsAttachments.limits.maxAttachmentSize.title')}
                    subtitle={typeof maxFileBytes === 'number' ? String(maxFileBytes) : t('common.default')}
                    icon={renderIcon('resize')}
                    onPress={async () => {
                        const raw = await Modal.prompt(
                            t('settingsAttachments.limits.maxAttachmentSize.promptTitle'),
                            t('settingsAttachments.limits.maxAttachmentSize.promptMessage'),
                            { placeholder: typeof maxFileBytes === 'number' ? String(maxFileBytes) : '26214400' },
                        );
                        if (raw === null) return;
                        const parsed = parsePositiveInt(raw, { min: 1024, max: 1024 * 1024 * 1024 });
                        if (parsed == null) {
                            Modal.alert(t('settingsAttachments.limits.invalidValueTitle'), t('settingsAttachments.limits.maxAttachmentSize.invalidValueMessage'));
                            return;
                        }
                        setMaxFileBytes(parsed);
                    }}
                />
            </ItemGroup>
        </ItemList>
    );
});
