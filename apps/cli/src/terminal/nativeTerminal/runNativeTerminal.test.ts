import { describe, expect, it } from 'vitest';

import { createPendingFirstInput, PIGGERCODE_DAEMON_PENDING_FIRST_INPUT_ENV_KEY, serializePendingFirstInputForEnv } from '@/daemon/spawn/pendingFirstInput';

import { takeNativeTerminalFirstPrompt } from './runNativeTerminal';

describe('takeNativeTerminalFirstPrompt', () => {
  it('takes the text the daemon handed over, so the session bootstrap cannot queue it as a chat message', () => {
    const env: NodeJS.ProcessEnv = {
      [PIGGERCODE_DAEMON_PENDING_FIRST_INPUT_ENV_KEY]: serializePendingFirstInputForEnv(
        createPendingFirstInput({ text: 'Fix the login bug', spawnNonce: 'nonce-1' }),
      ),
    };

    expect(takeNativeTerminalFirstPrompt(env)).toBe('Fix the login bug');
    expect(env[PIGGERCODE_DAEMON_PENDING_FIRST_INPUT_ENV_KEY]).toBeUndefined();
  });

  it('has no prompt when nothing was typed', () => {
    expect(takeNativeTerminalFirstPrompt({})).toBeNull();
  });
});
