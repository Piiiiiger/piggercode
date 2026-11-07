import { describe, expect, it } from 'vitest';

import { buildClaudeSubprocessEnv } from './buildClaudeSubprocessEnv';
import { CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR, resolveClaudeSessionEnvOverlay } from './resolveClaudeSessionEnvOverlay';

const sharedRoot = '/home/me/code';
const inSharedFolder = (path: string) => path === sharedRoot || path.startsWith(`${sharedRoot}/`);

describe('resolveClaudeSessionEnvOverlay', () => {
  it('leaves out the git status snapshot for a session in a shared folder', () => {
    const overlay = resolveClaudeSessionEnvOverlay({ cwd: '/home/me/code/app', baseEnv: {}, inSharedFolder });
    expect(overlay[CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR]).toBe('1');
    expect(buildClaudeSubprocessEnv({ baseEnv: { PATH: '/bin' }, envOverlay: overlay })[CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR]).toBe('1');
  });

  it('keeps git for a session anywhere else, or without a folder', () => {
    expect(resolveClaudeSessionEnvOverlay({ cwd: '/home/me/work/app', baseEnv: {}, inSharedFolder })).toEqual({});
    expect(resolveClaudeSessionEnvOverlay({ cwd: '/home/me/codex', baseEnv: {}, inSharedFolder })).toEqual({});
    expect(resolveClaudeSessionEnvOverlay({ cwd: '  ', baseEnv: {}, inSharedFolder: () => true })).toEqual({});
    expect(resolveClaudeSessionEnvOverlay({ baseEnv: {}, inSharedFolder: () => true })).toEqual({});
  });

  it('leaves a value the user set alone', () => {
    for (const value of ['0', '1', '']) {
      const overlay = resolveClaudeSessionEnvOverlay({
        cwd: '/home/me/code/app',
        baseEnv: { [CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR]: value },
        inSharedFolder,
      });
      expect(overlay).not.toHaveProperty(CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR);
    }
  });

  it('keeps the other overlay values', () => {
    expect(resolveClaudeSessionEnvOverlay({
      claudeCodeExperimentalAgentTeamsEnabled: true,
      claudeCodeIncludeInNativeHistory: true,
      cwd: '/home/me/code',
      baseEnv: {},
      inSharedFolder,
    })).toEqual({
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDE_CODE_ENTRYPOINT: 'piggercode',
      [CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS_ENV_VAR]: '1',
    });
  });
});
