import { realpath } from 'node:fs/promises';
import { basename, dirname, posix, win32 } from 'node:path';

import {
  filesystemPathComparisonKey,
  type FilesystemAccessPolicy,
  isFilesystemPathAbsolute,
  normalizeFilesystemPathForPolicy,
} from './filesystemAccessPolicy';

export type FilesystemPathAuthorizationResult =
  | Readonly<{ valid: true; resolvedPath: string }>
  | Readonly<{ valid: false; error: string }>;

export type AuthorizeFilesystemPathInput = Readonly<{
  targetPath: unknown;
  defaultDirectory: string;
  accessPolicy: FilesystemAccessPolicy;
  additionalAllowedDirs?: readonly string[];
  platform?: NodeJS.Platform;
}>;

export type FilesystemPathAuthorizer = (
  targetPath: unknown,
) => Promise<FilesystemPathAuthorizationResult>;

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

async function resolveRealPathForAuthorization(pathValue: string, platform: NodeJS.Platform): Promise<string> {
  const resolved = normalizeFilesystemPathForPolicy(pathValue, platform);
  if (platform !== process.platform) {
    return resolved;
  }

  const api = pathApi(platform);
  const missingSegments: string[] = [];
  let candidate = resolved;
  while (true) {
    try {
      const realAncestor = await realpath(candidate);
      return normalizeFilesystemPathForPolicy(
        api.join(realAncestor, ...missingSegments.reverse()),
        platform,
      );
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return resolved;
      missingSegments.push(basename(candidate));
      candidate = parent;
    }
  }
}

function isWithinResolvedRoot(targetPath: string, rootPath: string, platform: NodeJS.Platform): boolean {
  const api = pathApi(platform);
  const relativePath = api.relative(rootPath, targetPath);
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${api.sep}`) && !api.isAbsolute(relativePath));
}

async function isWithinRoot(targetPath: string, rootPath: string, platform: NodeJS.Platform): Promise<boolean> {
  const [target, root] = await Promise.all([
    resolveRealPathForAuthorization(targetPath, platform),
    resolveRealPathForAuthorization(rootPath, platform),
  ]);
  return isWithinResolvedRoot(
    filesystemPathComparisonKey(target, platform),
    filesystemPathComparisonKey(root, platform),
    platform,
  );
}

function normalizeAdditionalAllowedDirs(
  additionalAllowedDirs: readonly string[] | undefined,
  platform: NodeJS.Platform,
): string[] {
  return (additionalAllowedDirs ?? [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value) => isFilesystemPathAbsolute(value, platform))
    .map((value) => normalizeFilesystemPathForPolicy(value, platform));
}

export function resolveFilesystemTargetPath(input: Readonly<{
  targetPath: unknown;
  defaultDirectory: string;
  platform?: NodeJS.Platform;
}>): FilesystemPathAuthorizationResult {
  const platform = input.platform ?? process.platform;
  const api = pathApi(platform);
  const targetPath = typeof input.targetPath === 'string' ? input.targetPath : '';
  if (targetPath.length === 0) {
    return { valid: false, error: 'Path is required' };
  }
  if (targetPath.includes('\0')) {
    return { valid: false, error: 'Path contains invalid characters' };
  }
  if (!input.defaultDirectory || typeof input.defaultDirectory !== 'string') {
    return { valid: false, error: 'Access denied: Invalid default directory' };
  }

  const defaultDirectory = input.defaultDirectory.trim();
  if (!isFilesystemPathAbsolute(defaultDirectory, platform)) {
    return { valid: false, error: 'Access denied: Invalid default directory' };
  }

  const resolvedPath = isFilesystemPathAbsolute(targetPath, platform)
    ? normalizeFilesystemPathForPolicy(targetPath, platform)
    : normalizeFilesystemPathForPolicy(api.resolve(defaultDirectory, targetPath), platform);

  return { valid: true, resolvedPath };
}

export async function authorizeFilesystemPath(
  input: AuthorizeFilesystemPathInput,
): Promise<FilesystemPathAuthorizationResult> {
  const platform = input.platform ?? process.platform;
  const resolved = resolveFilesystemTargetPath({
    targetPath: input.targetPath,
    defaultDirectory: input.defaultDirectory,
    platform,
  });
  if (!resolved.valid) {
    return resolved;
  }

  if (input.accessPolicy.kind === 'osUser') {
    return resolved;
  }

  const allowedRoots = [
    ...input.accessPolicy.roots,
    ...normalizeAdditionalAllowedDirs(input.additionalAllowedDirs, platform),
  ];
  for (const root of allowedRoots) {
    if (await isWithinRoot(resolved.resolvedPath, root, platform)) {
      return resolved;
    }
  }

  return {
    valid: false,
    error: `Access denied: Path '${String(input.targetPath ?? '')}' is outside the allowed directories`,
  };
}

export async function prepareFilesystemPathAuthorizer(
  input: Omit<AuthorizeFilesystemPathInput, 'targetPath'>,
): Promise<FilesystemPathAuthorizer> {
  const platform = input.platform ?? process.platform;
  if (input.accessPolicy.kind === 'osUser') {
    return async (targetPath) => resolveFilesystemTargetPath({
      targetPath,
      defaultDirectory: input.defaultDirectory,
      platform,
    });
  }

  const allowedRoots = [
    ...input.accessPolicy.roots,
    ...normalizeAdditionalAllowedDirs(input.additionalAllowedDirs, platform),
  ];
  const resolvedRootKeys = await Promise.all(allowedRoots.map(async (root) => (
    filesystemPathComparisonKey(await resolveRealPathForAuthorization(root, platform), platform)
  )));

  return async (targetPath) => {
    const resolved = resolveFilesystemTargetPath({
      targetPath,
      defaultDirectory: input.defaultDirectory,
      platform,
    });
    if (!resolved.valid) return resolved;

    const resolvedTargetKey = filesystemPathComparisonKey(
      await resolveRealPathForAuthorization(resolved.resolvedPath, platform),
      platform,
    );
    for (const root of resolvedRootKeys) {
      if (isWithinResolvedRoot(resolvedTargetKey, root, platform)) {
        return resolved;
      }
    }

    return {
      valid: false,
      error: `Access denied: Path '${String(targetPath ?? '')}' is outside the allowed directories`,
    };
  };
}
