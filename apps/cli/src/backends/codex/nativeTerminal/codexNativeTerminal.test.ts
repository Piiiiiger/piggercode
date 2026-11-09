import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeServerSession } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';

import { followCodexThread, planCodexNativeTerminalLaunch } from './codexNativeTerminal';
import { readCodexThreadsHeldByProcess, type HeldCodexThread } from './readCodexThreadsHeldByProcess';

const ROOT = '01a1c03e-91d3-7dc3-a965-9f0c6ff6e973';
const SUBAGENT = '01a1c03f-0000-7000-8000-000000000001';
const NEXT = '01a1c040-0000-7000-8000-000000000002';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function codexHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codex-terminal-'));
  dirs.push(dir);
  return dir;
}

async function writeRollout(home: string, threadId: string, firstMessage: string | null): Promise<string> {
  const file = join(home, 'sessions', '2026', '11', '10', `rollout-2026-11-10T09-00-00-${threadId}.jsonl`);
  await mkdir(dirname(file), { recursive: true });
  const lines: unknown[] = [{ type: 'session_meta', payload: { id: threadId, cwd: '/repo' } }];
  if (firstMessage) {
    lines.push({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: firstMessage }] } });
  }
  await writeFile(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  return file;
}

describe('planCodexNativeTerminalLaunch', () => {
  it('starts a new conversation, with the text typed in the new-session screen as its first prompt', () => {
    expect(planCodexNativeTerminalLaunch({ resumeThreadId: null, firstPrompt: null })).toEqual({ threadId: null, args: [] });
    expect(planCodexNativeTerminalLaunch({ resumeThreadId: null, firstPrompt: '-v fix the login bug' }))
      .toEqual({ threadId: null, args: ['--', '-v fix the login bug'] });
  });

  it('reopens the conversation the session had', () => {
    expect(planCodexNativeTerminalLaunch({ resumeThreadId: ROOT, firstPrompt: null }))
      .toEqual({ threadId: ROOT, args: ['resume', ROOT] });
  });
});

describe.skipIf(process.platform !== 'linux')('readCodexThreadsHeldByProcess', () => {
  it('finds the conversation a running process writes from the files it holds open', async () => {
    const home = await codexHome();
    const rollout = await writeRollout(home, ROOT, null);
    const lock = join(home, 'thread-writer-locks', `${ROOT}.lock`);
    await mkdir(dirname(lock), { recursive: true });
    await writeFile(lock, '');
    const child = spawn('/bin/sh', ['-c', 'exec 3>>"$1" 4>>"$2"; sleep 30', 'sh', rollout, lock], { stdio: 'ignore' });
    try {
      await vi.waitFor(async () => {
        expect(await readCodexThreadsHeldByProcess(child.pid!)).toEqual([{ threadId: ROOT, rolloutPath: rollout }]);
      }, { timeout: 5_000 });
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('finds nothing for a process that writes no conversation, or one that is gone', async () => {
    const child = spawn('/bin/sh', ['-c', 'sleep 30'], { stdio: 'ignore' });
    try {
      expect(await readCodexThreadsHeldByProcess(child.pid!)).toEqual([]);
    } finally {
      child.kill('SIGKILL');
    }
    expect(await readCodexThreadsHeldByProcess(2 ** 30)).toEqual([]);
  });
});

describe('followCodexThread', () => {
  it('records the conversation the terminal writes, names the session after its first message, then after a rename in Codex', async () => {
    const home = await codexHome();
    const rollout = await writeRollout(home, ROOT, 'Fix the login bug');
    const next = await writeRollout(home, NEXT, 'Write the release notes');
    let held: HeldCodexThread[] = [];
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      childPid: 4242,
      codexHome: home,
      initialThreadId: null,
      readHeldThreads: async (pid) => (pid === 4242 ? held : []),
      intervalMs: 10,
    });
    try {
      held = [{ threadId: ROOT, rolloutPath: rollout }];
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        codexSessionId: ROOT,
        providerSessionInfoV1: { provider: 'codex', sessionId: ROOT, title: 'Fix the login bug' },
      }));

      await appendFile(join(home, 'session_index.jsonl'), `${JSON.stringify({ id: ROOT, thread_name: 'Login fix', updated_at: '2026-11-10T00:00:01Z' })}\n`);
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        summary: { text: 'Login fix' },
        providerSessionInfoV1: { sessionId: ROOT, title: 'Login fix' },
      }));

      // `/new` in Codex: the same process now writes another conversation.
      held = [{ threadId: NEXT, rolloutPath: next }];
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        codexSessionId: NEXT,
        providerSessionInfoV1: { sessionId: NEXT, title: 'Write the release notes' },
      }));
    } finally {
      await stop();
    }
  });

  it('looks as soon as Codex starts writing a conversation, not a poll later', async () => {
    const home = await codexHome();
    const rollout = await writeRollout(home, ROOT, 'Fix the login bug');
    await mkdir(join(home, 'thread-writer-locks'), { recursive: true });
    let held: HeldCodexThread[] = [];
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      childPid: 4242,
      codexHome: home,
      initialThreadId: null,
      readHeldThreads: async () => held,
      intervalMs: 60_000,
    });
    try {
      held = [{ threadId: ROOT, rolloutPath: rollout }];
      await writeFile(join(home, 'thread-writer-locks', `${ROOT}.lock`), '');
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ codexSessionId: ROOT }), { timeout: 2_000 });
    } finally {
      await stop();
    }
  });

  it('records the conversation and its title again after a write the relay rejected', async () => {
    const home = await codexHome();
    const rollout = await writeRollout(home, ROOT, 'Fix the login bug');
    const server = fakeServerSession();
    vi.mocked(server.session.updateMetadata)
      .mockRejectedValueOnce(new Error('relay away'))
      .mockRejectedValueOnce(new Error('relay away'));
    const stop = followCodexThread({
      session: server.session,
      childPid: 4242,
      codexHome: home,
      initialThreadId: null,
      readHeldThreads: async () => [{ threadId: ROOT, rolloutPath: rollout }],
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        codexSessionId: ROOT,
        providerSessionInfoV1: { sessionId: ROOT, title: 'Fix the login bug' },
      }));
    } finally {
      await stop();
    }
  });

  it('watches for new conversations once Codex makes its lock folder after the terminal started', async () => {
    const home = await codexHome();
    const rollout = await writeRollout(home, ROOT, 'Fix the login bug');
    // The process holds the conversation only briefly: it quits right after starting it.
    let heldUntil = 0;
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      childPid: 4242,
      codexHome: home,
      initialThreadId: null,
      readHeldThreads: async () => (Date.now() < heldUntil ? [{ threadId: ROOT, rolloutPath: rollout }] : []),
      intervalMs: 1_000,
    });
    try {
      await mkdir(join(home, 'thread-writer-locks'));
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      heldUntil = Date.now() + 150;
      await writeFile(join(home, 'thread-writer-locks', `${ROOT}.lock`), '');
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ codexSessionId: ROOT }), { timeout: 1_500 });
    } finally {
      await stop();
    }
  });

  it('stays with the conversation it follows while Codex also writes sub-agent conversations', async () => {
    const home = await codexHome();
    const root = await writeRollout(home, ROOT, 'Fix the login bug');
    const subagent = await writeRollout(home, SUBAGENT, 'Read the auth module');
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      childPid: 4242,
      codexHome: home,
      initialThreadId: null,
      readHeldThreads: async () => [
        { threadId: SUBAGENT, rolloutPath: subagent },
        { threadId: ROOT, rolloutPath: root },
      ],
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ codexSessionId: ROOT }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.metadata()).toMatchObject({ codexSessionId: ROOT, providerSessionInfoV1: { sessionId: ROOT } });
    } finally {
      await stop();
    }
  });

  it('keeps a reopened conversation when Codex holds it', async () => {
    const home = await codexHome();
    const root = await writeRollout(home, ROOT, 'Fix the login bug');
    const subagent = await writeRollout(home, '01a1c03d-0000-7000-8000-000000000003', 'An older sub-agent');
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      childPid: 4242,
      codexHome: home,
      initialThreadId: ROOT,
      readHeldThreads: async () => [
        { threadId: '01a1c03d-0000-7000-8000-000000000003', rolloutPath: subagent },
        { threadId: ROOT, rolloutPath: root },
      ],
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        providerSessionInfoV1: { sessionId: ROOT, title: 'Fix the login bug' },
      }));
      expect(server.metadata().codexSessionId).not.toBe('01a1c03d-0000-7000-8000-000000000003');
    } finally {
      await stop();
    }
  });
});
