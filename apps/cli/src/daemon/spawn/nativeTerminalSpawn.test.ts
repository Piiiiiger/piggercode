import { describe, expect, it } from 'vitest';

import { claudeDaemonSpawnHooks } from '@/backends/claude/daemon/spawnHooks';
import { codexDaemonSpawnHooks } from '@/backends/codex/daemon/spawnHooks';
import { resolveTerminalRequestFromSpawnOptions } from '@/terminal/runtime/terminalConfig';

import { resolveNativeTerminalHostRequest, resolveNativeTerminalSpawn } from './nativeTerminalSpawn';

describe('resolveNativeTerminalSpawn', () => {
  it('starts Claude terminal sessions as a local runner with no unified-terminal hooks', () => {
    expect(resolveNativeTerminalSpawn({ requested: true, agentId: 'claude', hooks: claudeDaemonSpawnHooks })).toEqual({
      ok: true,
      presentation: { kind: 'runner', startingMode: 'local', childEnv: { PIGGERCODE_CLAUDE_UNIFIED_TERMINAL_PIN: '0' } },
    });
  });

  it('starts Codex terminal sessions as a local runner', () => {
    expect(resolveNativeTerminalSpawn({ requested: true, agentId: 'codex', hooks: codexDaemonSpawnHooks })).toEqual({
      ok: true,
      presentation: { kind: 'runner', startingMode: 'local' },
    });
  });

  it('refuses a terminal session for an agent that has none instead of starting a chat session', () => {
    expect(resolveNativeTerminalSpawn({ requested: true, agentId: 'codex', hooks: {} })).toEqual({
      ok: false,
      errorMessage: 'codex has no terminal sessions.',
    });
  });

  it('leaves ordinary spawns alone', () => {
    expect(resolveNativeTerminalSpawn({ requested: false, agentId: 'claude', hooks: claudeDaemonSpawnHooks }))
      .toEqual({ ok: true, presentation: null });
  });
});

describe('resolveNativeTerminalHostRequest', () => {
  it('runs a terminal session in tmux whatever host the request named, keeping its tmux options', () => {
    const home = '/home/u/.piggercode';
    expect(resolveTerminalRequestFromSpawnOptions({ happyHomeDir: home, terminal: resolveNativeTerminalHostRequest(undefined) }))
      .toMatchObject({ requested: 'tmux', tmux: { sessionName: 'happy', isolated: true } });
    expect(resolveTerminalRequestFromSpawnOptions({ happyHomeDir: home, terminal: resolveNativeTerminalHostRequest({ mode: 'plain' }) }))
      .toMatchObject({ requested: 'tmux' });
    expect(resolveNativeTerminalHostRequest({ mode: 'tmux', tmux: { sessionName: 'work', isolated: false } }))
      .toEqual({ mode: 'tmux', tmux: { sessionName: 'work', isolated: false } });
  });
});
