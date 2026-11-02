import { describe, expect, it } from 'vitest';

import { resolveStackProcessKindOverrideForSessionSpawn } from './resolveStackProcessKindOverrideForSessionSpawn';

describe('resolveStackProcessKindOverrideForSessionSpawn', () => {
  it('returns empty when no stack env file is present', () => {
    expect(resolveStackProcessKindOverrideForSessionSpawn({})).toEqual({});
    expect(resolveStackProcessKindOverrideForSessionSpawn({ PIGGERCODE_STACK_ENV_FILE: '' })).toEqual({});
    expect(resolveStackProcessKindOverrideForSessionSpawn({ PIGGERCODE_STACK_ENV_FILE: '   ' })).toEqual({});
  });

  it('forces PIGGERCODE_STACK_PROCESS_KIND=session when a stack env file is present', () => {
    expect(
      resolveStackProcessKindOverrideForSessionSpawn({
        PIGGERCODE_STACK_ENV_FILE: '/tmp/stack.env',
        PIGGERCODE_STACK_PROCESS_KIND: 'infra',
      }),
    ).toEqual({ PIGGERCODE_STACK_PROCESS_KIND: 'session' });

    expect(
      resolveStackProcessKindOverrideForSessionSpawn({
        PIGGERCODE_STACK_ENV_FILE: '/tmp/stack.env',
        PIGGERCODE_STACK_PROCESS_KIND: 'session',
      }),
    ).toEqual({ PIGGERCODE_STACK_PROCESS_KIND: 'session' });
  });

  it('uses the same stack context markers as the child process env builder', () => {
    expect(
      resolveStackProcessKindOverrideForSessionSpawn({
        PIGGERCODE_STACK_STACK: 'repo-remote-dev',
        PIGGERCODE_STACK_PROCESS_KIND: 'infra',
      }),
    ).toEqual({ PIGGERCODE_STACK_PROCESS_KIND: 'session' });

    expect(
      resolveStackProcessKindOverrideForSessionSpawn({
        PIGGERCODE_STACK_REPO_DIR: '/tmp/repo',
        PIGGERCODE_STACK_PROCESS_KIND: 'infra',
      }),
    ).toEqual({ PIGGERCODE_STACK_PROCESS_KIND: 'session' });
  });
});
