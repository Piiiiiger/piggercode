import { isInSharedFolder } from '@/integrations/folderShare/sharedFolderMounts';

export const CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_ENV_VAR = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS' as const;
export const CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR = 'CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS' as const;

export function resolveClaudeSessionEnvOverlay(params: Readonly<{
  claudeCodeExperimentalAgentTeamsEnabled?: boolean;
  claudeCodeIncludeInNativeHistory?: boolean;
  /** The folder the session works in. */
  cwd?: string | null;
  /** The environment Claude Code inherits; a value set there wins. Defaults to this process's. */
  baseEnv?: NodeJS.ProcessEnv;
  inSharedFolder?: (path: string) => boolean;
}>): Record<string, string> {
  return {
    ...(params.claudeCodeExperimentalAgentTeamsEnabled === true
      ? { [CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_ENV_VAR]: '1' } : {}),
    // Claude Code 2.1.283/2.1.296 rewrite cli to sdk-cli on noninteractive runs.
    // Happier attribution survives and avoids the SDK history exclusion without
    // rewriting provider-owned transcripts.
    ...(params.claudeCodeIncludeInNativeHistory === true ? { CLAUDE_CODE_ENTRYPOINT: 'piggercode' } : {}),
    ...(skipsGitStatus(params) ? { [CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR]: '1' } : {}),
  };
}

/**
 * Before its first answer Claude Code runs `git status` for its prompt. In a folder another computer shares
 * here, that reads every file of the repository over the connection (git's saved file times never match a
 * second machine's), which takes minutes in a big repository while the message waits. This variable leaves
 * out that status and the commit instructions; agents there run git on the computer anyway.
 */
function skipsGitStatus(params: Readonly<{
  cwd?: string | null;
  baseEnv?: NodeJS.ProcessEnv;
  inSharedFolder?: (path: string) => boolean;
}>): boolean {
  const cwd = typeof params.cwd === 'string' ? params.cwd.trim() : '';
  if (!cwd) return false;
  if ((params.baseEnv ?? process.env)[CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR] !== undefined) return false;
  return (params.inSharedFolder ?? isInSharedFolder)(cwd);
}
