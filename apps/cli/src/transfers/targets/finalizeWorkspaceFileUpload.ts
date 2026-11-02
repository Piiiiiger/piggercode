import { mkdir, open, rm, stat } from 'fs/promises';
import { basename, dirname, join } from 'path';

import { withKeepBothSuffix } from '@piggercode/transfers';

import { moveFileWithCrossDeviceFallback } from '../../utils/fs/moveFileWithCrossDeviceFallback';
import type { UploadTransferFinalizeResult } from './uploadTransferTarget';

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : null;
}

/**
 * Claims the first free name among `name.ext`, `name (1).ext`, `name (2).ext`, ... by creating it
 * exclusively, so two uploads with the same name never end up in the same file.
 */
async function claimFreeFilePath(destPath: string): Promise<string> {
  const directory = dirname(destPath);
  const fileName = basename(destPath);
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? destPath : join(directory, withKeepBothSuffix(fileName, attempt));
    try {
      const handle = await open(candidate, 'wx');
      await handle.close();
      return candidate;
    } catch (error) {
      if (readErrorCode(error) !== 'EEXIST') throw error;
    }
  }
}

function withFileName(displayPath: string, fileName: string): string {
  const separatorIndex = Math.max(displayPath.lastIndexOf('/'), displayPath.lastIndexOf('\\'));
  return `${displayPath.slice(0, separatorIndex + 1)}${fileName}`;
}

export async function finalizeWorkspaceFileUpload(input: Readonly<{
  tempPath: string;
  destPath: string;
  destDisplayPath: string;
  overwrite: boolean;
  /** Keep an existing file and store the upload under the next free `name (n).ext` instead (see `withKeepBothSuffix`). */
  renameIfExists?: boolean;
  sizeBytes: number;
}>): Promise<UploadTransferFinalizeResult> {
  await mkdir(dirname(input.destPath), { recursive: true });

  if (input.renameIfExists) {
    const claimedPath = await claimFreeFilePath(input.destPath);
    try {
      await moveFileWithCrossDeviceFallback(input.tempPath, claimedPath);
    } catch (error) {
      await rm(claimedPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return {
      success: true,
      path: withFileName(input.destDisplayPath, basename(claimedPath)),
      sizeBytes: input.sizeBytes,
    };
  }

  const destStats = await stat(input.destPath).catch((error: unknown) => {
    if (readErrorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  });

  if (destStats) {
    if (destStats.isDirectory()) {
      return { success: false, error: 'Cannot overwrite a directory with a file', keepSession: true };
    }
    if (!input.overwrite) {
      return { success: false, error: 'Destination already exists', keepSession: true };
    }
    await rm(input.destPath, { force: true });
  }

  await moveFileWithCrossDeviceFallback(input.tempPath, input.destPath);
  return {
    success: true,
    path: input.destDisplayPath,
    sizeBytes: input.sizeBytes,
  };
}
