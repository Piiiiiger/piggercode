import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { recordCliUpdateCheck } from '@piggercode/cli-common/update';

import { createSystemTasksCapability, listAdvertisedSystemTaskKinds, systemTasksCapability } from './toolSystemTasks';

describe('systemTasksCapability', () => {
  it('detects the supported methods and kinds', async () => {
    await expect(systemTasksCapability.detect({
      request: { id: 'tool.systemTasks' },
      context: { cliSnapshot: null },
    })).resolves.toEqual({
      available: true,
      kinds: [
        'remote.ssh.bootstrapMachine.v1',
        'relay.runtime.installOrUpdate.v1',
        'relay.runtime.start.v1',
        'relay.runtime.status.v1',
        'relay.runtime.stop.v1',
      ],
      methods: ['start', 'poll', 'respond'],
    });
  });

  it('advertises cli.update.v1 only where this machine can update its CLI remotely', () => {
    expect(listAdvertisedSystemTaskKinds({ canUpdateCliRemotely: true })).toContain('cli.update.v1');
    expect(listAdvertisedSystemTaskKinds({ canUpdateCliRemotely: false })).not.toContain('cli.update.v1');
  });

  it('has this machine look up its CLI\'s latest version when the daily check is due, and right away for a check-now', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-system-tasks-cli-check-'));
    try {
      const spawned: string[][] = [];
      const capability = createSystemTasksCapability(undefined, {
        cliUpdateCheck: () => ({
          homeDir,
          cliRootDir: homeDir,
          env: {},
          publicReleaseRing: 'stable',
          // The detached `self check` process is the boundary: it looks the release up and rewrites the cache.
          spawnDetached: ({ args }) => { spawned.push(args); },
        }),
      });
      recordCliUpdateCheck({
        homeDir, publicReleaseRing: 'stable', latest: '1.0.0', current: '1.0.0', runtimeVersion: null, invokerVersion: '1.0.0',
        nowMs: Date.now() - 60_000,
      });

      // Checked a minute ago: the Updates surface's ordinary read leaves the daily check alone.
      await capability.detect({ request: { id: 'tool.systemTasks' }, context: { cliSnapshot: null } });
      expect(spawned).toEqual([]);

      // "Check now" (the request's `bypassCache`) looks again at once.
      await capability.detect({ request: { id: 'tool.systemTasks', params: { bypassCache: true } }, context: { cliSnapshot: null } });
      expect(spawned).toEqual([['self', 'check', '--quiet']]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('delegates start, poll, and respond through the stateful runner', async () => {
    const calls: Array<Readonly<{ method: string; params: Record<string, unknown> }>> = [];
    const capability = createSystemTasksCapability({
      start: async (params) => {
        calls.push({ method: 'start', params: params as Record<string, unknown> });
        return { taskId: 'task-1' };
      },
      poll: async (params) => {
        calls.push({ method: 'poll', params: params as Record<string, unknown> });
        return {
          events: [],
          nextCursor: 0,
          pendingPrompt: null,
          result: null,
        };
      },
      respond: async (params) => {
        calls.push({ method: 'respond', params: params as Record<string, unknown> });
      },
    });

    await expect(capability.invoke?.({
      method: 'start',
      params: {
        spec: {
          protocolVersion: 1,
          kind: 'relay.runtime.status.v1',
          params: {},
        },
      },
    })).resolves.toEqual({
      ok: true,
      result: { taskId: 'task-1' },
    });

    await expect(capability.invoke?.({
      method: 'poll',
      params: {
        taskId: 'task-1',
        cursor: 0,
      },
    })).resolves.toEqual({
      ok: true,
      result: {
        events: [],
        nextCursor: 0,
        pendingPrompt: null,
        result: null,
      },
    });

    await expect(capability.invoke?.({
      method: 'respond',
      params: {
        taskId: 'task-1',
        answer: { approved: true },
      },
    })).resolves.toEqual({
      ok: true,
      result: { ok: true },
    });

    expect(calls).toEqual([
      {
        method: 'start',
        params: {
          spec: {
            protocolVersion: 1,
            kind: 'relay.runtime.status.v1',
            params: {},
          },
        },
      },
      {
        method: 'poll',
        params: {
          taskId: 'task-1',
          cursor: 0,
        },
      },
      {
        method: 'respond',
        params: {
          taskId: 'task-1',
          answer: { approved: true },
        },
      },
    ]);
  });
});
