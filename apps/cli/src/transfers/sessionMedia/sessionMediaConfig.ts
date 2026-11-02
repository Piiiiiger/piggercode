import {
    isFilesystemPathAbsolute,
    normalizeFilesystemPathForPolicy,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

export type SessionMediaUploadLocation = 'workspace' | 'os_temp' | 'shared_folder';
export type SessionMediaVcsIgnoreStrategy = 'git_info_exclude' | 'gitignore' | 'none';

export type SessionMediaTransferConfig = Readonly<{
    uploadLocation: SessionMediaUploadLocation;
    workspaceRelativeDir: string;
    /** Folder on this machine that `shared_folder` uploads go to, as the user typed it (`~` allowed). */
    sharedFolderPath?: string;
    vcsIgnoreStrategy: SessionMediaVcsIgnoreStrategy;
    vcsIgnoreWritesEnabled: boolean;
}>;

export const DEFAULT_SESSION_MEDIA_TRANSFER_CONFIG: SessionMediaTransferConfig = {
    uploadLocation: 'workspace',
    workspaceRelativeDir: '.piggercode/uploads',
    vcsIgnoreStrategy: 'git_info_exclude',
    vcsIgnoreWritesEnabled: true,
};

export function normalizeSessionMediaUploadLocation(value: unknown): SessionMediaUploadLocation | null {
    if (value === 'workspace' || value === 'os_temp' || value === 'shared_folder') return value;
    return null;
}

export function normalizeSessionMediaVcsIgnoreStrategy(value: unknown): SessionMediaVcsIgnoreStrategy | null {
    if (value === 'git_info_exclude' || value === 'gitignore' || value === 'none') return value;
    return null;
}

export function normalizeSessionMediaWorkspaceRelativeDir(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return null;
    if (/^[a-zA-Z]:/.test(trimmed)) return null;
    const parts = trimmed.split(/[\\/]+/g).filter(Boolean);
    if (parts.some((part) => part === '.' || part === '..')) return null;
    return parts.join('/');
}

/**
 * The shared folder as an absolute path on this machine, with `~` resolved to the home folder of the
 * user running the daemon. Returns null for relative paths and paths with `.` or `..` parts.
 */
export function normalizeSessionMediaSharedFolderPath(
    value: unknown,
    processEnv: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('\0')) return null;
    const expanded = expandHomeDirPath(trimmed, processEnv, platform);
    if (!isFilesystemPathAbsolute(expanded, platform)) return null;
    if (expanded.split(/[\\/]+/g).some((part) => part === '.' || part === '..')) return null;
    return normalizeFilesystemPathForPolicy(expanded, platform);
}
