import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { resolveSharedFolderPathSetting } from '@/components/sessions/attachments/useAttachmentsUploadConfig';
import { CodeBlockView } from '@/components/ui/code/blocks/CodeBlockView';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Modal, type CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { useSetting, useSettingMutable } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { resolveConfiguredProductName } from '@/text/productName';

import {
    buildSharedFolderMountCommands,
    parseSshAddress,
    sharedFolderInstallCommand,
    type SharedFolderMountPlatform,
} from './sharedFolderMountCommands';

export const SHARED_FOLDER_MOUNT_GUIDE_TEST_ID = 'shared-folder-mount-guide';

const stylesheet = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
        minHeight: 0,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 20,
        gap: 18,
    },
    intro: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    step: {
        gap: 8,
    },
    stepTitle: {
        fontSize: 14,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    stepNote: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
}));

function defaultPlatform(): SharedFolderMountPlatform {
    if (Platform.OS === 'ios' || Platform.OS === 'macos') return 'macos';
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)) {
        return 'macos';
    }
    return 'linux';
}

function GuideStep(props: Readonly<{ index: number; title: string; note?: string; command: string; testID: string }>) {
    const styles = stylesheet;
    return (
        <View style={styles.step} testID={props.testID}>
            <Text style={styles.stepTitle}>{`${props.index}. ${props.title}`}</Text>
            {props.note ? <Text style={styles.stepNote}>{props.note}</Text> : null}
            <CodeBlockView code={props.command} language="bash" showCopyButton wrap />
        </View>
    );
}

/**
 * How to make the shared folder show up in the file manager of the person's own computer with
 * SSHFS. The commands are built from the saved SSH address, so they can be copied as they are.
 */
export function SharedFolderMountGuideModal(props: CustomModalInjectedProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [sshAddress, setSshAddress] = useSettingMutable('attachmentsUploadsSharedFolderSshAddress');
    const sharedFolderPathSetting = useSetting('attachmentsUploadsSharedFolderPath');
    const [platform, setPlatform] = React.useState<SharedFolderMountPlatform>(defaultPlatform);

    const sharedFolderPath = resolveSharedFolderPathSetting(sharedFolderPathSetting);
    const mountDirName = `${resolveConfiguredProductName()}Share`;
    const savedAddress = typeof sshAddress === 'string' ? sshAddress.trim() : '';
    const address = savedAddress ? parseSshAddress(savedAddress) : null;
    const commands = address
        ? buildSharedFolderMountCommands({ platform, address, sharedFolderPath, mountDirName })
        : null;

    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('settingsAttachments.sharedFolder.mountGuide.title'),
        testID: SHARED_FOLDER_MOUNT_GUIDE_TEST_ID,
        layout: 'fill' as const,
        dimensions: { width: 600, maxHeightRatio: 0.92, size: 'md' as const },
    }), []);
    useModalCardChrome(props.setChrome, chrome);

    const editAddress = React.useCallback(async () => {
        const raw = await Modal.prompt(
            t('settingsAttachments.sharedFolder.mountGuide.address.promptTitle'),
            t('settingsAttachments.sharedFolder.mountGuide.address.promptMessage'),
            { defaultValue: savedAddress },
        );
        if (raw === null) return;
        if (!parseSshAddress(raw)) {
            Modal.alert(
                t('settingsAttachments.sharedFolder.mountGuide.address.invalidTitle'),
                t('settingsAttachments.sharedFolder.mountGuide.address.invalidMessage'),
            );
            return;
        }
        setSshAddress(raw.trim());
    }, [savedAddress, setSshAddress]);

    const platformTabs = React.useMemo(() => ([
        { id: 'linux' as const, label: t('settingsAttachments.sharedFolder.mountGuide.platformLinux') },
        { id: 'macos' as const, label: t('settingsAttachments.sharedFolder.mountGuide.platformMacos') },
    ]), []);

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <Text style={styles.intro}>
                {t('settingsAttachments.sharedFolder.mountGuide.intro', { mountPoint: `~/${mountDirName}`, folder: sharedFolderPath })}
            </Text>

            <SegmentedTabBar
                tabs={platformTabs}
                activeTabId={platform}
                onSelectTab={setPlatform}
                testIDPrefix="shared-folder-mount-platform"
            />

            <ItemGroup>
                <Item
                    testID="shared-folder-mount-address"
                    title={t('settingsAttachments.sharedFolder.mountGuide.address.title')}
                    subtitle={savedAddress || t('settingsAttachments.sharedFolder.mountGuide.address.notSet')}
                    icon={<Icon name="globe" size={29} color={theme.colors.text.secondary} />}
                    onPress={() => { void editAddress(); }}
                />
            </ItemGroup>

            <GuideStep
                index={1}
                testID="shared-folder-mount-step-install"
                title={t('settingsAttachments.sharedFolder.mountGuide.steps.installTitle')}
                note={platform === 'macos'
                    ? t('settingsAttachments.sharedFolder.mountGuide.steps.installNoteMacos')
                    : t('settingsAttachments.sharedFolder.mountGuide.steps.installNoteLinux')}
                command={commands?.install ?? sharedFolderInstallCommand(platform)}
            />

            {commands ? (
                <>
                    <GuideStep
                        index={2}
                        testID="shared-folder-mount-step-check"
                        title={t('settingsAttachments.sharedFolder.mountGuide.steps.checkTitle')}
                        note={t('settingsAttachments.sharedFolder.mountGuide.steps.checkNote')}
                        command={commands.check}
                    />
                    <GuideStep
                        index={3}
                        testID="shared-folder-mount-step-mount"
                        title={t('settingsAttachments.sharedFolder.mountGuide.steps.mountTitle')}
                        note={t('settingsAttachments.sharedFolder.mountGuide.steps.mountNote', { mountPoint: `~/${mountDirName}` })}
                        command={commands.mount}
                    />
                    <GuideStep
                        index={4}
                        testID="shared-folder-mount-step-unmount"
                        title={t('settingsAttachments.sharedFolder.mountGuide.steps.unmountTitle')}
                        command={commands.unmount}
                    />
                </>
            ) : (
                <Text style={styles.stepNote} testID="shared-folder-mount-address-missing">
                    {t('settingsAttachments.sharedFolder.mountGuide.address.missing')}
                </Text>
            )}
        </ScrollView>
    );
}
