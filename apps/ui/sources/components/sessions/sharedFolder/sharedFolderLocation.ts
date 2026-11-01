import { resolveAbsolutePath } from '@/utils/path/pathUtils';

export type SharedFolderLocation = Readonly<{
    /** The folder on the session's machine, in the form file requests need. */
    absolutePath: string;
    /** The folder as the user set it, for display. */
    displayPath: string;
}>;

function trimTrailingSlashes(path: string): string {
    const trimmed = path.replace(/\/+$/g, '');
    return trimmed.length > 0 ? trimmed : path;
}

/**
 * Places the shared folder on the session's machine. The machine expands nothing in file
 * requests, so `~` needs that machine's home folder; without it there is no location.
 */
export function resolveSharedFolderLocation(input: Readonly<{
    sharedFolderPath: string;
    homeDir: string | null | undefined;
}>): SharedFolderLocation | null {
    const displayPath = trimTrailingSlashes(input.sharedFolderPath.trim());
    const absolutePath = trimTrailingSlashes(resolveAbsolutePath(displayPath, input.homeDir ?? undefined));
    if (!absolutePath.startsWith('/')) return null;
    return { absolutePath, displayPath };
}
