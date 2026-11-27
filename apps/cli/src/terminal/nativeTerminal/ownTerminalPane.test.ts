import { describe, expect, it } from 'vitest';

import type { TmuxCommandResult } from '@/integrations/tmux/types';

import { createOwnTerminalPane } from './ownTerminalPane';

const ok = (stdout: string, command: readonly string[]): TmuxCommandResult => ({ returncode: 0, stdout, stderr: '', command: [...command] });

describe('createOwnTerminalPane', () => {
  it('is null outside tmux', () => {
    expect(createOwnTerminalPane({ env: {} })).toBeNull();
    expect(createOwnTerminalPane({ env: { TMUX: '/tmp/tmux-1/default,1,0' } })).toBeNull();
  });

  it('reads its own pane with the colours kept, and types a line followed by Enter', async () => {
    const sent: string[][] = [];
    const pane = createOwnTerminalPane({
      env: { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%7' },
      executor: async (args) => {
        sent.push([...args]);
        return ok(args[0] === 'capture-pane' ? '\u001b[94m>\u001b[39m hi\n' : '', args);
      },
    });
    expect(pane).not.toBeNull();
    expect(await pane!.readScreen()).toContain('\u001b[94m>');
    expect(sent[0]).toEqual(['capture-pane', '-p', '-e', '-t', '%7']);

    sent.length = 0;
    expect(await pane!.typeLine('Continue where you left off')).toBe(true);
    expect(sent).toEqual([
      ['send-keys', '-t', '%7', '-l', '--', 'Continue where you left off'],
      ['send-keys', '-t', '%7', 'Enter'],
    ]);
  });

  it('says it did not read or type when tmux is gone', async () => {
    const pane = createOwnTerminalPane({
      env: { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%7' },
      executor: async () => null,
    });
    expect(await pane!.readScreen()).toBeNull();
    expect(await pane!.typeLine('x')).toBe(false);
  });
});
