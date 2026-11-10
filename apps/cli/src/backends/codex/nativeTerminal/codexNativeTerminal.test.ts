import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { configOptionOverrides, fakeServerSession, NO_CONTROLS } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';

import { followCodexThread, planCodexNativeTerminalLaunch, readCodexConversationTitle } from './codexNativeTerminal';

const FIRST = '01a1c03e-91d3-7dc3-a965-9f0c6ff6e973';
const SAME_NAME_ELSEWHERE = '01a1c03f-0000-7000-8000-000000000001';
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

/** A conversation as Codex keeps it: its rollout (with the folder it runs in) and its name in the index. */
async function conversation(home: string, threadId: string, cwd: string, name: string): Promise<void> {
  const file = join(home, 'sessions', '2026', '11', '10', `rollout-2026-11-10T09-00-00-${threadId}.jsonl`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd } })}\n`);
  await rename(home, threadId, name);
}

/** Codex writing to a conversation (its rollout's modification time moves on). */
async function write(home: string, threadId: string, atSeconds: number): Promise<void> {
  const file = join(home, 'sessions', '2026', '11', '10', `rollout-2026-11-10T09-00-00-${threadId}.jsonl`);
  await utimes(file, atSeconds, atSeconds);
}

async function rename(home: string, threadId: string, name: string): Promise<void> {
  await appendFile(join(home, 'session_index.jsonl'), `${JSON.stringify({ id: threadId, thread_name: name, updated_at: '2026-11-10T00:00:00Z' })}\n`);
}

describe('planCodexNativeTerminalLaunch', () => {
  it('starts a new conversation, with the text typed in the new-session screen as its first prompt', () => {
    expect(planCodexNativeTerminalLaunch({ resumeThreadId: null, firstPrompt: null, controls: NO_CONTROLS })).toEqual({ threadId: null, args: [] });
    expect(planCodexNativeTerminalLaunch({ resumeThreadId: null, firstPrompt: '-v fix the login bug', controls: NO_CONTROLS }))
      .toEqual({ threadId: null, args: ['--', '-v fix the login bug'] });
  });

  it('reopens the conversation the session had', () => {
    expect(planCodexNativeTerminalLaunch({ resumeThreadId: FIRST, firstPrompt: null, controls: NO_CONTROLS }))
      .toEqual({ threadId: FIRST, args: ['resume', FIRST] });
  });
});

describe('planCodexNativeTerminalLaunch with the new-session screen\'s choices', () => {
  it('starts codex with the chosen model, permissions, thinking and speed', () => {
    expect(planCodexNativeTerminalLaunch({
      resumeThreadId: null,
      firstPrompt: 'hi',
      controls: {
        ...NO_CONTROLS,
        modelId: 'gpt-6.1-sol',
        permissionMode: 'safe-yolo',
        configOptionOverrides: configOptionOverrides({ reasoning_effort: 'high', service_tier: 'fast' }),
      },
    }).args).toEqual([
      '--model', 'gpt-6.1-sol',
      '--ask-for-approval', 'never', '--sandbox', 'workspace-write',
      '-c', 'model_reasoning_effort="high"', '-c', 'service_tier="fast"',
      '--', 'hi',
    ]);
  });

  it('leaves approvals and sandbox to the Codex config for 「CLI 设置」, and Standard speed to Codex', () => {
    expect(planCodexNativeTerminalLaunch({
      resumeThreadId: null,
      firstPrompt: null,
      controls: { ...NO_CONTROLS, permissionMode: 'default', configOptionOverrides: configOptionOverrides({ service_tier: 'standard' }) },
    }).args).toEqual([]);
  });

  it('reopens a conversation with the same choices', () => {
    expect(planCodexNativeTerminalLaunch({
      resumeThreadId: FIRST,
      firstPrompt: null,
      controls: { ...NO_CONTROLS, permissionMode: 'yolo', modelId: 'gpt-6.1-sol' },
    }).args).toEqual(['--model', 'gpt-6.1-sol', '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', 'resume', FIRST]);
  });
});

describe('readCodexConversationTitle', () => {
  it('reads the conversation title Codex puts before the folder in its window title', () => {
    expect(readCodexConversationTitle('Fix login | repo', 'repo')).toBe('Fix login');
    expect(readCodexConversationTitle('A | B | repo', 'repo')).toBe('A | B');
    expect(readCodexConversationTitle('repo', 'repo')).toBeNull();
    expect(readCodexConversationTitle('bash', 'repo')).toBeNull();
    expect(readCodexConversationTitle(null, 'repo')).toBeNull();
  });
});

describe('followCodexThread', () => {
  it('records the conversation the terminal shows, the one with that name in this folder, and follows it to the next', async () => {
    const home = await codexHome();
    await conversation(home, FIRST, '/work/repo', 'Fix login');
    await conversation(home, SAME_NAME_ELSEWHERE, '/work/other/repo', 'Fix login');
    let windowTitle = 'repo';
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      codexHome: home,
      directory: '/work/repo',
      initialThreadId: null,
      readWindowTitle: async () => windowTitle,
      intervalMs: 10,
    });
    try {
      windowTitle = 'Fix login | repo';
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        codexSessionId: FIRST,
        summary: { text: 'Fix login' },
        providerSessionInfoV1: { provider: 'codex', sessionId: FIRST, title: 'Fix login' },
      }));

      // `/new`: a conversation Codex has not named yet, then named.
      windowTitle = 'repo';
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(server.metadata()).toMatchObject({ codexSessionId: FIRST });
      await conversation(home, NEXT, '/work/repo', 'Release notes');
      windowTitle = 'Release notes | repo';
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        codexSessionId: NEXT,
        summary: { text: 'Release notes' },
      }));
    } finally {
      await stop();
    }
  });

  it('keeps a reopened conversation and takes its renames', async () => {
    const home = await codexHome();
    await conversation(home, FIRST, '/work/repo', 'Fix login');
    let windowTitle = 'Fix login | repo';
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      codexHome: home,
      directory: '/work/repo',
      initialThreadId: FIRST,
      readWindowTitle: async () => windowTitle,
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ summary: { text: 'Fix login' } }));
      await rename(home, FIRST, 'Login fix');
      windowTitle = 'Login fix | repo';
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        summary: { text: 'Login fix' },
        providerSessionInfoV1: { sessionId: FIRST, title: 'Login fix' },
      }));
    } finally {
      await stop();
    }
  });

  it('takes the one Codex wrote last among conversations of the same name, and keeps it while another terminal writes to its namesake', async () => {
    const home = await codexHome();
    await conversation(home, FIRST, '/work/repo', 'Fix login');
    await conversation(home, NEXT, '/work/repo', 'Fix login');
    await write(home, FIRST, 2_000_000_000);
    await write(home, NEXT, 1_000_000_000);
    const server = fakeServerSession();
    const stop = followCodexThread({
      session: server.session,
      codexHome: home,
      directory: '/work/repo',
      initialThreadId: null,
      readWindowTitle: async () => 'Fix login | repo',
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ codexSessionId: FIRST }));
      await write(home, NEXT, 2_100_000_000);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.metadata()).toMatchObject({ codexSessionId: FIRST });
    } finally {
      await stop();
    }
  });

  it('records the conversation and its title again after a write the relay rejected', async () => {
    const home = await codexHome();
    await conversation(home, FIRST, '/work/repo', 'Fix login');
    const server = fakeServerSession();
    vi.mocked(server.session.updateMetadata)
      .mockRejectedValueOnce(new Error('relay away'))
      .mockRejectedValueOnce(new Error('relay away'));
    const stop = followCodexThread({
      session: server.session,
      codexHome: home,
      directory: '/work/repo',
      initialThreadId: null,
      readWindowTitle: async () => 'Fix login | repo',
      intervalMs: 10,
    });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        codexSessionId: FIRST,
        providerSessionInfoV1: { sessionId: FIRST, title: 'Fix login' },
      }));
    } finally {
      await stop();
    }
  });
});
