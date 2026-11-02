import { describe, expect, it } from 'vitest';

import { sanitizeDaemonEnvForSpawn } from './daemon';

describe('sanitizeDaemonEnvForSpawn', () => {
  it('defaults daemon test spawns to disabled caffeinate while stripping session-only env', () => {
    const env = sanitizeDaemonEnvForSpawn({
      PATH: '/usr/bin',
      PIGGERCODE_SESSION_ATTACH_FILE: '/tmp/attach.json',
      PIGGERCODE_STACK_TOOL_TRACE_FILE: '/tmp/trace.json',
      TMUX: 'tmux-123',
    });

    expect(env.PIGGERCODE_DISABLE_CAFFEINATE).toBe('1');
    expect(env.PIGGERCODE_DAEMON_SESSION_RESPAWN_ENABLED).toBe('0');
    expect(env.PIGGERCODE_SESSION_ATTACH_FILE).toBeUndefined();
    expect(env.PIGGERCODE_STACK_TOOL_TRACE_FILE).toBeUndefined();
    expect(env.TMUX).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});
