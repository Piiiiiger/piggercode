import * as React from 'react';

import { settingsDefaults } from '@/sync/domains/settings/settings';
import { useSetting } from '@/sync/domains/state/storage';
import type { AttachmentsUploadConfig } from '@/sync/domains/transfers/ops/uploadSessionAttachment';

function trimmedOr(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** Turns the account's attachment settings into the config each upload sends to the machine. */
export function resolveAttachmentsUploadConfig(settings: Readonly<{
    uploadLocation: unknown;
    sharedFolderPath: unknown;
    workspaceRelativeDir: unknown;
    vcsIgnoreStrategy: unknown;
    vcsIgnoreWritesEnabled: unknown;
    maxFileBytes: unknown;
}>): AttachmentsUploadConfig {
    const uploadLocation =
        settings.uploadLocation === 'shared_folder' || settings.uploadLocation === 'workspace' || settings.uploadLocation === 'os_temp'
            ? settings.uploadLocation
            : settingsDefaults.attachmentsUploadsUploadLocation;
    const vcsIgnoreStrategy =
        settings.vcsIgnoreStrategy === 'gitignore' || settings.vcsIgnoreStrategy === 'none'
            ? settings.vcsIgnoreStrategy
            : 'git_info_exclude';
    const maxFileBytes =
        typeof settings.maxFileBytes === 'number' && Number.isFinite(settings.maxFileBytes)
            ? Math.max(1024, Math.floor(settings.maxFileBytes))
            : 25 * 1024 * 1024;

    return {
        uploadLocation,
        sharedFolderPath: trimmedOr(settings.sharedFolderPath, settingsDefaults.attachmentsUploadsSharedFolderPath),
        workspaceRelativeDir: trimmedOr(settings.workspaceRelativeDir, settingsDefaults.attachmentsUploadsWorkspaceRelativeDir),
        vcsIgnoreStrategy,
        vcsIgnoreWritesEnabled: settings.vcsIgnoreWritesEnabled !== false,
        maxFileBytes,
    };
}

export function useAttachmentsUploadConfig(): AttachmentsUploadConfig {
    const uploadLocation = useSetting('attachmentsUploadsUploadLocation');
    const sharedFolderPath = useSetting('attachmentsUploadsSharedFolderPath');
    const workspaceRelativeDir = useSetting('attachmentsUploadsWorkspaceRelativeDir');
    const vcsIgnoreStrategy = useSetting('attachmentsUploadsVcsIgnoreStrategy');
    const vcsIgnoreWritesEnabled = useSetting('attachmentsUploadsVcsIgnoreWritesEnabled');
    const maxFileBytes = useSetting('attachmentsUploadsMaxFileBytes');

    return React.useMemo(
        () => resolveAttachmentsUploadConfig({
            uploadLocation,
            sharedFolderPath,
            workspaceRelativeDir,
            vcsIgnoreStrategy,
            vcsIgnoreWritesEnabled,
            maxFileBytes,
        }),
        [maxFileBytes, sharedFolderPath, uploadLocation, vcsIgnoreStrategy, vcsIgnoreWritesEnabled, workspaceRelativeDir],
    );
}
