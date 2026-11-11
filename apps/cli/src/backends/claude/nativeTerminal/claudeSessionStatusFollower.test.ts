import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { NativeTerminalActivity } from '@/terminal/nativeTerminal/nativeTerminalActivityReporter';

import { claudeSessionStatusPath, followClaudeSessionStatus, readClaudeSessionActivity } from './claudeSessionStatusFollower';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A record as Claude Code 2.1.322 writes it (fields it adds besides these are left out). */
function record(fields: Record<string, unknown>): string {
  return JSON.stringify({ pid: '4242', sessionId: 'c-1', kind: 'interactive', ...fields });
}

describe('readClaudeSessionActivity', () => {
  it('reads working, idle, approvals and questions, and leaves dialogs the user opened alone', () => {
    expect(readClaudeSessionActivity({ status: 'busy' })).toEqual({ kind: 'working' });
    expect(readClaudeSessionActivity({ status: 'idle' })).toEqual({ kind: 'idle' });
    expect(readClaudeSessionActivity({ status: 'waiting', waitingFor: 'permission prompt' })).toEqual({ kind: 'waiting', on: 'permission' });
    expect(readClaudeSessionActivity({ status: 'waiting', waitingFor: 'sandbox request' })).toEqual({ kind: 'waiting', on: 'permission' });
    expect(readClaudeSessionActivity({ status: 'waiting', waitingFor: 'input needed' })).toEqual({ kind: 'waiting', on: 'question' });
    expect(readClaudeSessionActivity({ status: 'waiting', waitingFor: 'dialog open' })).toBeNull();
    expect(readClaudeSessionActivity({ status: 'starting' })).toBeNull();
  });
});

describe('followClaudeSessionStatus', () => {
  it('reports each change of the record Claude keeps for its process, once', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'claude-status-'));
    dirs.push(configDir);
    const statusPath = claudeSessionStatusPath(configDir, 4242);
    expect(statusPath).toBe(join(configDir, 'sessions', '4242.json'));
    const reported: NativeTerminalActivity[] = [];
    const stop = followClaudeSessionStatus({ statusPath, reportActivity: (activity) => reported.push(activity), intervalMs: 20 });

    // Claude has not written it yet.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reported).toEqual([]);

    await mkdir(join(configDir, 'sessions'));
    await writeFile(statusPath, record({ status: 'busy' }));
    await expect.poll(() => reported).toEqual([{ kind: 'working' }]);
    await writeFile(statusPath, record({ status: 'waiting', waitingFor: 'permission prompt' }));
    await expect.poll(() => reported).toEqual([{ kind: 'working' }, { kind: 'waiting', on: 'permission' }]);
    await writeFile(statusPath, record({ status: 'idle' }));
    await expect.poll(() => reported.at(-1)).toEqual({ kind: 'idle' });

    await stop();
    await writeFile(statusPath, record({ status: 'busy' }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reported).toHaveLength(3);
  });
});
