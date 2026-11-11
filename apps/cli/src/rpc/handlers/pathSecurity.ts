import { realpath } from 'fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path';

export interface PathValidationResult {
    valid: boolean;
    error?: string;
    resolvedPath?: string;
}

async function resolveRealPathThroughExistingAncestor(targetPath: string): Promise<string> {
    let candidate = targetPath;
    const missingSegments: string[] = [];

    for (;;) {
        try {
            return resolve(await realpath(candidate), ...missingSegments);
        } catch {
            const parent = dirname(candidate);
            if (parent === candidate) return targetPath;
            missingSegments.unshift(basename(candidate));
            candidate = parent;
        }
    }
}

export function validateWorkspaceInspectionPath(targetPath: string): PathValidationResult {
    const trimmedPath = typeof targetPath === 'string' ? targetPath.trim() : '';
    if (!trimmedPath) {
        return {
            valid: false,
            error: 'candidatePath is required',
        };
    }
    if (trimmedPath.includes('\0')) {
        return {
            valid: false,
            error: 'Attached workspace candidate path contains invalid characters',
        };
    }
    if (!isAbsolute(trimmedPath)) {
        return {
            valid: false,
            error: 'Attached workspace candidate path must be absolute',
        };
    }

    return {
        valid: true,
        resolvedPath: resolve(trimmedPath),
    };
}

/**
 * Validates that a path is within the allowed working directory
 * @param targetPath - The path to validate (can be relative or absolute)
 * @param workingDirectory - The session's working directory (must be absolute)
 * @param additionalAllowedDirs - Extra absolute directories that are also permitted
 * @returns Validation result
 */
export async function validatePath(
    targetPath: string,
    workingDirectory: string,
    additionalAllowedDirs?: ReadonlyArray<string>,
): Promise<PathValidationResult> {
    if (!workingDirectory || typeof workingDirectory !== 'string') {
        return { valid: false, error: 'Access denied: Invalid working directory' };
    }

    // Resolve and realpath the working directory to ensure comparisons stay consistent on platforms
    // where e.g. /var is a symlink to /private/var (macOS).
    const resolvedWorkingDir = resolve(workingDirectory);
    const realWorkingDir = await resolveRealPathThroughExistingAncestor(resolvedWorkingDir);

    // Resolve the target against the real working dir to keep it on the same canonical root.
    const resolvedTarget = resolve(realWorkingDir, targetPath);

    const resolvedExtraDirs = (additionalAllowedDirs ?? [])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => resolve(value));

    // Resolve symlinks for the target when possible to prevent traversal via symlinks.
    // If the file doesn't exist yet, validate based on the realpath of its parent directory.
    const realTarget = await resolveRealPathThroughExistingAncestor(resolvedTarget);

    const allowedDirs = await Promise.all([realWorkingDir, ...resolvedExtraDirs].map(async (dir) => {
        try {
            return await realpath(dir);
        } catch {
            // Directory may not exist yet (e.g., upload dir before first upload).
            return dir;
        }
    }));

    for (const dir of allowedDirs) {
        const rel = relative(dir, realTarget);
        if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
            return { valid: true, resolvedPath: resolvedTarget };
        }
    }

    return {
        valid: false,
        error: `Access denied: Path '${targetPath}' is outside the allowed directories`,
    };
}
