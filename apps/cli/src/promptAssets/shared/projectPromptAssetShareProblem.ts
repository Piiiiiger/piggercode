import { checkSharedFolderPath } from '@/integrations/folderShare/sharedFolderHealth';

/**
 * Why a project-scoped prompt asset cannot be written into `directory` now, or null: a project in a folder another
 * computer shares here while that computer is away (`checkSharedFolderPath`). The directory is read as
 * `resolveScopedPromptAssetRoot` reads it (trimmed), so the folder checked is the folder written.
 */
export async function projectPromptAssetShareProblem(
  scope: 'user' | 'project',
  directory: string | null | undefined,
): Promise<string | null> {
  if (scope !== 'project') return null;
  const trimmed = typeof directory === 'string' ? directory.trim() : '';
  return trimmed ? (await checkSharedFolderPath(trimmed)).problem : null;
}
