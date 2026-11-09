import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeServerSession } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';

import { followClaudeTitle } from './claudeNativeTerminal';
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
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'new-id', args: ['--session-id', 'new-id'] });
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      firstPrompt: null,
      transcriptExists: (id) => id === 'old-id',
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: ['--resume', 'old-id'] });
  });

  it('starts a conversation that never got a message again under its own id instead of failing to resume it', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      firstPrompt: null,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: ['--session-id', 'old-id'] });
  });

  it('gives claude the text typed in the new-session screen as its first prompt, even one that looks like a flag', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: null,
      firstPrompt: '--help me fix the login bug',
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'new-id', args: ['--session-id', 'new-id', '--', '--help me fix the login bug'] });
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
