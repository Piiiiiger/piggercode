import { describe, expect, it, vi } from 'vitest';

import { runTmuxAttach } from '@/terminal/attachment/tmuxAttach';

type SpawnTmuxCall = {
  args: string[];
  env: NodeJS.ProcessEnv;
  stdio: 'inherit' | 'ignore';
};

describe('runTmuxAttach', () => {
  it('attaches through a temporary single-window tmux session when attaching from outside tmux', async () => {
    const spawnTmuxFn = vi.fn<(params: SpawnTmuxCall) => Promise<number>>(async (_params) => 0);

    await runTmuxAttach({
      sessionId: 'sid-1',
      terminal: {
        mode: 'tmux',
        requested: 'tmux',
        tmux: { target: 'happy:window-1' },
      },
    }, {
      isTmuxAvailableFn: async () => true,
      spawnTmuxFn,
      nowMs: 5678,
      processId: 1234,
      insideTmux: false,
    });

    expect(spawnTmuxFn.mock.calls.map(([call]) => call)).toEqual([
      {
        args: ['select-window', '-t', '=happy:window-1'],
        env: expect.any(Object),
        stdio: 'ignore',
      },
      {
        args: [
          'new-session',
          '-d',
          '-s',
          'happy-attach-sid-1-1234-5678',
          '-n',
          '__happier_attach_placeholder__',
          'sleep 2147483647',
        ],
        env: expect.any(Object),
        stdio: 'ignore',
      },
      {
        args: [
          'set-option', '-t', 'happy-attach-sid-1-1234-5678', 'status', 'off',
          ';', 'set-option', '-t', 'happy-attach-sid-1-1234-5678', 'mouse', 'on',
        ],
        env: expect.any(Object),
        stdio: 'ignore',
      },
      {
        args: ['link-window', '-s', '=happy:window-1', '-t', 'happy-attach-sid-1-1234-5678:'],
        env: expect.any(Object),
        stdio: 'ignore',
      },
      {
        args: ['kill-window', '-t', 'happy-attach-sid-1-1234-5678:__happier_attach_placeholder__'],
        env: expect.any(Object),
        stdio: 'ignore',
      },
      {
        args: [
          'set-option', '-q', '-w', '-t', '=happy:window-1', 'allow-passthrough', 'on',
          ';', 'set-hook', '-w', '-t', '=happy:window-1', 'pane-mode-changed',
          "if-shell -F '#{&&:#{==:#{pane_mode},copy-mode},#{&&:#{==:#{history_size},0},#{?selection_present,0,1}}}' 'send-keys -X cancel'",
          ';', 'bind-key', '-T', 'copy-mode', 'WheelUpPane', 'send-keys', '-X', 'scroll-up',
          ';', 'bind-key', '-T', 'copy-mode', 'WheelDownPane', 'send-keys', '-X', 'scroll-down',
          ';', 'bind-key', '-T', 'copy-mode-vi', 'WheelUpPane', 'send-keys', '-X', 'scroll-up',
          ';', 'bind-key', '-T', 'copy-mode-vi', 'WheelDownPane', 'send-keys', '-X', 'scroll-down',
        ],
        env: expect.any(Object),
        stdio: 'ignore',
      },
      {
        args: [
          'attach-session', '-t', 'happy-attach-sid-1-1234-5678',
          ';', 'set-option', '-t', 'happy-attach-sid-1-1234-5678', 'destroy-unattached', 'on',
        ],
        env: expect.any(Object),
        stdio: 'inherit',
      },
      {
        args: ['kill-session', '-t', 'happy-attach-sid-1-1234-5678'],
        env: expect.any(Object),
        stdio: 'ignore',
      },
    ]);
  });
});
