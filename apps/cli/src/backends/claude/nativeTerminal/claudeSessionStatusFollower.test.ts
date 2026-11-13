import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { NativeTerminalActivity } from '@/terminal/nativeTerminal/nativeTerminalActivityReporter';

import { claudeSessionStatusPath, followClaudeSessionStatus, readClaudeSessionActivity } from './claudeSessionStatusFollower';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Replaces the record at once, so a read never sees it half written (unless a test writes it so). */
async function writeRecord(path: string, content: string): Promise<void> {
  await writeFile(`${path}.tmp`, content);
  await rename(`${path}.tmp`, path);
}

/** A record as Claude Code 2.1.322 writes it (fields it adds besides these are left out). */
function record(fields: Record<string, unknown>): string {
  return JSON.stringify({ pid: '4242', sessionId: 'c-1', kind: 'interactive', ...fields });
}

describe('readClaudeSessionActivity', () => {
  it('reads working, idle, approvals and questions, and leaves dialogs the user opened alone', () => {
    expect(readClaudeSessionActivity({ status: 'busy' })).toEqual({ kind: 'working' });
    expect(readClaudeSessionActivity({ status: 'idle' })).toEqual({ kind: 'idle' });
    // Claude Code 2.1.323: idle, with a background shell it started still running.
    expect(readClaudeSessionActivity({ status: 'shell' })).toEqual({ kind: 'idle', background: true });
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

    // Claude has not written it yet: what it shows is not known (said once).
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reported).toEqual([{ kind: 'unknown' }]);

    await mkdir(join(configDir, 'sessions'));
    await writeRecord(statusPath, record({ status: 'busy' }));
    await expect.poll(() => reported).toEqual([{ kind: 'unknown' }, { kind: 'working' }]);
    await writeRecord(statusPath, record({ status: 'waiting', waitingFor: 'permission prompt' }));
    await expect.poll(() => reported.slice(1)).toEqual([{ kind: 'working' }, { kind: 'waiting', on: 'permission' }]);
    await writeRecord(statusPath, record({ status: 'idle' }));
    await expect.poll(() => reported.at(-1)).toEqual({ kind: 'idle' });

    await stop();
    await writeRecord(statusPath, record({ status: 'busy' }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reported).toHaveLength(4);
  });

  it('says once when it cannot tell what Claude shows, and reports the record again once it can, even unchanged', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'claude-status-'));
    dirs.push(configDir);
    await mkdir(join(configDir, 'sessions'));
    const statusPath = claudeSessionStatusPath(configDir, 4242);
    await writeRecord(statusPath, record({ status: 'idle' }));
    const reported: NativeTerminalActivity[] = [];
    const stop = followClaudeSessionStatus({ statusPath, reportActivity: (activity) => reported.push(activity), intervalMs: 20 });
    await expect.poll(() => reported).toEqual([{ kind: 'idle' }]);

    // A state this does not know (a newer Claude), then the record goes missing for a moment.
    await writeRecord(statusPath, record({ status: 'compacting' }));
    await expect.poll(() => reported).toEqual([{ kind: 'idle' }, { kind: 'unknown' }]);
    await rm(statusPath);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reported).toHaveLength(2);

    // The same record as before comes back: it is reported, so the runner learns Claude is idle again.
    await writeRecord(statusPath, record({ status: 'idle' }));
    await expect.poll(() => reported).toEqual([{ kind: 'idle' }, { kind: 'unknown' }, { kind: 'idle' }]);

    // A record that is not whole JSON says nothing either; the same idle record after it is reported again.
    await writeRecord(statusPath, '{"status": "bu');
    await expect.poll(() => reported.at(-1)).toEqual({ kind: 'unknown' });
    await writeRecord(statusPath, record({ status: 'idle' }));
    await expect.poll(() => reported).toEqual([
      { kind: 'idle' }, { kind: 'unknown' }, { kind: 'idle' }, { kind: 'unknown' }, { kind: 'idle' },
    ]);
    await stop();
  });
});
