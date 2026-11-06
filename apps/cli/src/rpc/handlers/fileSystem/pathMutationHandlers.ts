import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { basename, dirname, join, relative, resolve as resolvePath } from 'path';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import {
  isWithin,
  listSharedFolderMounts,
  readMountinfoIfAny,
  realHomeOf,
  type SharedFolderMount,
} from '@/integrations/folderShare/sharedFolderMounts';
import { logger } from '@/ui/logger';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { FilesystemAccessPolicy } from './accessPolicy/filesystemAccessPolicy';
import { resolveFilesystemPolicyProtectedRoots } from './accessPolicy/filesystemAccessPolicy';
import { authorizeFilesystemPath } from './accessPolicy/filesystemPathAuthorization';

type StatFileRequest = Readonly<{ path: string }>;
type StatFileResponse =
  | Readonly<{
      success: true;
      exists: boolean;
      kind?: 'file' | 'directory' | 'other';
      sizeBytes?: number;
      modifiedMs?: number;
    }>
  | Readonly<{ success: false; error: string }>;

type RenamePathRequest = Readonly<{ from: string; to: string; overwrite?: boolean }>;
type RenamePathResponse = Readonly<{ success: true } | { success: false; error: string }>;

type DeletePathRequest = Readonly<{ path: string; recursive?: boolean }>;
type DeletePathResponse = Readonly<{ success: true } | { success: false; error: string }>;

function resolveRealPathBestEffort(path: string): string {
  const resolved = resolvePath(path);
  try {
    return realpathSync(resolved);
  } catch {
    try {
      const parent = realpathSync(dirname(resolved));
      return resolvePath(parent, basename(resolved));
    } catch {
      return resolved;
    }
  }
}

/**
 * Why deleting, renaming or replacing `path` would act on another computer's files: it is a folder that
 * computer shares here (`listSharedFolderMounts`), or it holds one, and the change would reach through
 * the mount. Null when neither.
 */
function sharedFolderProblem(path: string, mounts: readonly SharedFolderMount[]): string | null {
  const shared = mounts.find((mount) => isWithin(mount.path, path));
  if (!shared) return null;
  return shared.path === path
    ? `${path} is a folder the computer ${shared.label} shares here; stop sharing it from that computer first`
    : `${path} holds ${shared.path}, a folder the computer ${shared.label} shares here; stop sharing it from that computer first`;
}

function isRootPath(resolvedPath: string, protectedRoots: readonly string[]): boolean {
  const normalizedTarget = resolveRealPathBestEffort(resolvedPath);
  return protectedRoots.some((root) => normalizedTarget === resolveRealPathBestEffort(root));
}

export function registerPathMutationHandlers(
  rpcHandlerManager: RpcHandlerRegistrar,
  deps: Readonly<{
    defaultDirectory: string;
    accessPolicy: FilesystemAccessPolicy;
    getAdditionalAllowedReadDirs: () => ReadonlyArray<string>;
    getAdditionalAllowedWriteDirs: () => ReadonlyArray<string>;
    /** Where the folders other computers share here are read: this home and the OS's mount table by default. */
    sharedFolders?: Readonly<{ homeDir: string; readMountinfo: () => string }>;
  }>,
): void {
  const sharedFolders = deps.sharedFolders ?? { homeDir: homedir(), readMountinfo: readMountinfoIfAny };
  // Checked before anything resolves or stats the path, which through a dropped connection's mount
  // would wait until that connection ends: as given first, then as it resolves, against the mounts as
  // the mount table names them, and only while something is shared here.
  const sharedFolderProblemAt = (resolvedPath: string): string | null => {
    const mounts = listSharedFolderMounts(sharedFolders.homeDir, sharedFolders.readMountinfo());
    if (mounts.length === 0) return null;
    const realHome = realHomeOf(sharedFolders.homeDir);
    const asMounted = realHome === sharedFolders.homeDir
      ? mounts
      : mounts.map((mount) => ({ ...mount, path: join(realHome, relative(sharedFolders.homeDir, mount.path)) }));
    // As given, spelled through the home or as the mount table names it, before anything resolves it.
    const asGiven = sharedFolderProblem(resolvedPath, mounts) ?? sharedFolderProblem(resolvedPath, asMounted);
    // Inside a shared folder nothing here is at stake (shared folders never nest).
    if (asGiven || [...mounts, ...asMounted].some((mount) => isWithin(resolvedPath, mount.path))) return asGiven;
    return sharedFolderProblem(resolveRealPathBestEffort(resolvedPath), asMounted);
  };
  const protectedRoots = resolveFilesystemPolicyProtectedRoots({
    defaultDirectory: deps.defaultDirectory,
    accessPolicy: deps.accessPolicy,
  });

  rpcHandlerManager.registerHandler<StatFileRequest, StatFileResponse>(RPC_METHODS.STAT_FILE, async (data) => {
    const path = typeof data?.path === 'string' ? data.path : '';
    logger.debug('Stat file request:', path);

    const validation = authorizeFilesystemPath({
      targetPath: path,
      defaultDirectory: deps.defaultDirectory,
      accessPolicy: deps.accessPolicy,
      additionalAllowedDirs: deps.getAdditionalAllowedReadDirs(),
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const stats = await stat(validation.resolvedPath);
      const kind = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
      return {
        success: true,
        exists: true,
        kind,
        sizeBytes: stats.size,
        modifiedMs: stats.mtime.getTime(),
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { success: true, exists: false };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Failed to stat path' };
    }
  });

  rpcHandlerManager.registerHandler<RenamePathRequest, RenamePathResponse>(RPC_METHODS.RENAME_PATH, async (data) => {
    const from = typeof data?.from === 'string' ? data.from : '';
    const to = typeof data?.to === 'string' ? data.to : '';
    const overwrite = Boolean(data?.overwrite);
    logger.debug('Rename path request:', from, '->', to);

    const fromValidation = authorizeFilesystemPath({
      targetPath: from,
      defaultDirectory: deps.defaultDirectory,
      accessPolicy: deps.accessPolicy,
      additionalAllowedDirs: deps.getAdditionalAllowedWriteDirs(),
    });
    const toValidation = authorizeFilesystemPath({
      targetPath: to,
      defaultDirectory: deps.defaultDirectory,
      accessPolicy: deps.accessPolicy,
      additionalAllowedDirs: deps.getAdditionalAllowedWriteDirs(),
    });
    if (!fromValidation.valid) {
      return { success: false, error: fromValidation.error };
    }
    if (!toValidation.valid) {
      return { success: false, error: toValidation.error };
    }
    const shared = sharedFolderProblemAt(fromValidation.resolvedPath) ?? sharedFolderProblemAt(toValidation.resolvedPath);
    if (shared) {
      return { success: false, error: shared };
    }

    if (isRootPath(fromValidation.resolvedPath, protectedRoots)) {
      return { success: false, error: 'Cannot rename the working directory root' };
    }
    if (isRootPath(toValidation.resolvedPath, protectedRoots)) {
      return { success: false, error: 'Cannot rename into the working directory root' };
    }

    try {
      const destExists = await stat(toValidation.resolvedPath).then(() => true).catch((e: any) => e?.code !== 'ENOENT');
      if (destExists) {
        if (!overwrite) {
          return { success: false, error: 'Destination already exists' };
        }
        await rm(toValidation.resolvedPath, { recursive: true, force: true });
      }

      await mkdir(dirname(toValidation.resolvedPath), { recursive: true });
      await rename(fromValidation.resolvedPath, toValidation.resolvedPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to rename path' };
    }
  });

  rpcHandlerManager.registerHandler<DeletePathRequest, DeletePathResponse>(RPC_METHODS.DELETE_PATH, async (data) => {
    const path = typeof data?.path === 'string' ? data.path : '';
    const recursive = Boolean(data?.recursive);
    logger.debug('Delete path request:', path, 'recursive:', recursive);

    const validation = authorizeFilesystemPath({
      targetPath: path,
      defaultDirectory: deps.defaultDirectory,
      accessPolicy: deps.accessPolicy,
      additionalAllowedDirs: deps.getAdditionalAllowedWriteDirs(),
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const shared = sharedFolderProblemAt(validation.resolvedPath);
    if (shared) {
      return { success: false, error: shared };
    }

    if (isRootPath(validation.resolvedPath, protectedRoots)) {
      return { success: false, error: 'Cannot delete the working directory root' };
    }

    try {
      const stats = await stat(validation.resolvedPath);
      if (stats.isDirectory() && !recursive) {
        return { success: false, error: 'Refusing to delete a directory without recursive=true' };
      }

      await rm(validation.resolvedPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { success: true };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete path' };
    }
  });
}
