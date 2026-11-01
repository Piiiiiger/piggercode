import { describe, expect, it } from 'vitest';

import { resolveAttachmentsUploadConfig } from './useAttachmentsUploadConfig';

const baseSettings = {
    uploadLocation: 'shared_folder',
    sharedFolderPath: '~/Downloads',
    workspaceRelativeDir: '.happier/uploads',
    vcsIgnoreStrategy: 'git_info_exclude',
    vcsIgnoreWritesEnabled: true,
    maxFileBytes: 25 * 1024 * 1024,
} as const;

describe('resolveAttachmentsUploadConfig', () => {
    it('uploads into the shared folder the user chose', () => {
        expect(resolveAttachmentsUploadConfig({ ...baseSettings, sharedFolderPath: '  /srv/share  ' })).toMatchObject({
            uploadLocation: 'shared_folder',
            sharedFolderPath: '/srv/share',
        });
    });

    it('uses the home Downloads folder when the shared folder path is blank', () => {
        expect(resolveAttachmentsUploadConfig({ ...baseSettings, sharedFolderPath: '   ' })).toMatchObject({
            uploadLocation: 'shared_folder',
            sharedFolderPath: '~/Downloads',
        });
    });

    it('keeps the workspace and OS temp locations', () => {
        expect(resolveAttachmentsUploadConfig({ ...baseSettings, uploadLocation: 'workspace' }).uploadLocation).toBe('workspace');
        expect(resolveAttachmentsUploadConfig({ ...baseSettings, uploadLocation: 'os_temp' }).uploadLocation).toBe('os_temp');
    });
});
