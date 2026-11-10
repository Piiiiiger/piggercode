import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeServerSession, NO_CONTROLS } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';

import { claudeNativeTerminalEnv, followClaudeTitle } from './claudeNativeTerminal';
import { planClaudeNativeTerminalLaunch } from './claudeNativeTerminalLaunch';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('planClaudeNativeTerminalLaunch', () => {
  it('passes claude only the conversation to start or resume', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: null,
      firstPrompt: null,
      controls: NO_CONTROLS,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'new-id', args: ['--session-id', 'new-id'] });
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      firstPrompt: null,
      controls: NO_CONTROLS,
      transcriptExists: (id) => id === 'old-id',
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: ['--resume', 'old-id'] });
  });

  it('starts a conversation that never got a message again under its own id instead of failing to resume it', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      firstPrompt: null,
      controls: NO_CONTROLS,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: ['--session-id', 'old-id'] });
  });

  it('gives claude the text typed in the new-session screen as its first prompt, even one that looks like a flag', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: null,
      firstPrompt: '--help me fix the login bug',
      controls: NO_CONTROLS,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'new-id', args: ['--session-id', 'new-id', '--', '--help me fix the login bug'] });
  });
});

describe('planClaudeNativeTerminalLaunch with the new-session screen\'s choices', () => {
  const args = (controls: Partial<typeof NO_CONTROLS>, resume: string | null = null) => planClaudeNativeTerminalLaunch({
    resumeClaudeSessionId: resume,
    firstPrompt: resume ? null : 'hi',
    controls: { ...NO_CONTROLS, ...controls },
    transcriptExists: () => resume !== null,
    newClaudeSessionId: () => 'new-id',
  }).args;

  it('starts claude with the chosen model and its own name for the chosen permissions', () => {
    expect(args({ modelId: 'opus', permissionMode: 'bypassPermissions' }))
      .toEqual(['--session-id', 'new-id', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--', 'hi']);
    expect(args({ permissionMode: 'read-only' })).toEqual(['--session-id', 'new-id', '--permission-mode', 'dontAsk', '--', 'hi']);
    expect(args({ permissionMode: 'safe-yolo' })).toEqual(['--session-id', 'new-id', '--permission-mode', 'auto', '--', 'hi']);
  });

  it('starts in plan mode when plan was chosen, and leaves the default permissions to claude', () => {
    expect(args({ permissionMode: 'safe-yolo', agentModeId: 'plan' }))
      .toEqual(['--session-id', 'new-id', '--permission-mode', 'plan', '--', 'hi']);
    expect(args({ permissionMode: 'default', agentModeId: 'build' })).toEqual(['--session-id', 'new-id', '--', 'hi']);
  });

  it('reopens a conversation with the same choices', () => {
    expect(args({ modelId: 'sonnet', permissionMode: 'safe-yolo' }, 'old-id'))
      .toEqual(['--resume', 'old-id', '--model', 'sonnet', '--permission-mode', 'auto']);
  });
});

describe('claudeNativeTerminalEnv', () => {
  it('skips the git status Claude spends minutes on in a folder another computer shares, as chat sessions do', () => {
    expect(claudeNativeTerminalEnv({ baseEnv: { PATH: '/bin' }, directory: '/home/u/code/repo', inSharedFolder: () => true })
      .CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS).toBe('1');
    expect(claudeNativeTerminalEnv({ baseEnv: { PATH: '/bin' }, directory: '/srv/repo', inSharedFolder: () => false })
      .CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS).toBeUndefined();
  });
});

describe('followClaudeTitle', () => {
  it('names the session after the title Claude gives the conversation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-terminal-'));
    dirs.push(dir);
    const transcriptPath = join(dir, 'c-1.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Fix login', sessionId: 'c-1' })}\n`);
    const server = fakeServerSession();

    const stop = followClaudeTitle({ session: server.session, transcriptPath, claudeSessionId: 'c-1' });
    try {
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        summary: { text: 'Fix login' },
        providerSessionInfoV1: { provider: 'claude', sessionId: 'c-1', title: 'Fix login' },
      }));
    } finally {
      await stop();
    }
  });

  it('names the session again after a write the relay rejected, once Claude writes more', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-terminal-'));
    dirs.push(dir);
    const transcriptPath = join(dir, 'c-1.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Fix login', sessionId: 'c-1' })}\n`);
    const server = fakeServerSession();
    vi.mocked(server.session.updateMetadata).mockRejectedValueOnce(new Error('relay away'));

    const stop = followClaudeTitle({ session: server.session, transcriptPath, claudeSessionId: 'c-1' });
    try {
      await vi.waitFor(() => expect(server.session.updateMetadata).toHaveBeenCalledTimes(1));
      await appendFile(transcriptPath, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'and the tests' } })}\n`);
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ summary: { text: 'Fix login' } }));
    } finally {
      await stop();
    }
  });

  it('still reads a change Claude made while a write the relay then rejected was under way', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-terminal-'));
    dirs.push(dir);
    const transcriptPath = join(dir, 'c-1.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Fix login', sessionId: 'c-1' })}\n`);
    const server = fakeServerSession();
    let rejectWrite: (error: Error) => void = () => undefined;
    vi.mocked(server.session.updateMetadata).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectWrite = reject;
    }));

    const stop = followClaudeTitle({ session: server.session, transcriptPath, claudeSessionId: 'c-1' });
    try {
      await vi.waitFor(() => expect(server.session.updateMetadata).toHaveBeenCalledTimes(1));
      await appendFile(transcriptPath, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'and the tests' } })}\n`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      rejectWrite(new Error('relay away'));
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ summary: { text: 'Fix login' } }));
    } finally {
      await stop();
    }
  });
});
