import { checkSharedFolderPath, isInSharedFolder } from '@/integrations/folderShare/sharedFolderHealth';

/**
 * Why a session cannot be given this tmux socket folder (its TMUX_TMPDIR) now, or null: the folder lies in a folder
 * another computer shares here while that computer is away (`checkSharedFolderPath`). Made there, it would sit on this
 * server's own disk and keep the share from mounting again. A TMUX_TMPDIR the daemon itself inherits is tmux's own
 * setting and is not checked: tmux makes its folder under it on any command the daemon runs, before any spawn.
 */
export async function tmuxTmpDirSharedFolderProblem(tmpDir: string | null): Promise<string | null> {
  if (!tmpDir || !isInSharedFolder(tmpDir)) return null;
  return (await checkSharedFolderPath(tmpDir)).problem;
}
