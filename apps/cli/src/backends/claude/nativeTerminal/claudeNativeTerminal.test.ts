import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { configOptionOverrides, fakeServerSession, NO_CONTROLS } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';

import { claudeNativeTerminalEnv, followClaudeTitle } from './claudeNativeTerminal';
import { planClaudeNativeTerminalLaunch } from './claudeNativeTerminalLaunch';

/** Claude Code's default renderer, given as a flag (it outranks every settings file). */
const RENDERER = ['--settings', '{"tui":"fullscreen"}'];

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
    })).toEqual({ claudeSessionId: 'new-id', args: [...RENDERER, '--session-id', 'new-id'] });
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      firstPrompt: null,
      controls: NO_CONTROLS,
      transcriptExists: (id) => id === 'old-id',
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: [...RENDERER, '--resume', 'old-id'] });
  });

  it('starts a conversation that never got a message again under its own id instead of failing to resume it', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      firstPrompt: null,
      controls: NO_CONTROLS,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: [...RENDERER, '--session-id', 'old-id'] });
  });

  it('keeps claude on its fullscreen renderer whatever a settings file says, now or later', () => {
    // A running claude switches renderer when `tui` changes in a settings file, and a session switched out of
    // the fullscreen renderer that way stays blank or cut off; a flag outranks the files, so the switch never comes.
    for (const resume of [null, 'old-id']) {
      const { args } = planClaudeNativeTerminalLaunch({
        resumeClaudeSessionId: resume,
        firstPrompt: 'hi',
        controls: NO_CONTROLS,
        transcriptExists: () => resume !== null,
        newClaudeSessionId: () => 'new-id',
      });
      const at = args.indexOf('--settings');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(args.indexOf('--'));
      expect(JSON.parse(args[at + 1] ?? '')).toEqual({ tui: 'fullscreen' });
    }
  });

  it('gives claude the text typed in the new-session screen as its first prompt, even one that looks like a flag', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: null,
      firstPrompt: '--help me fix the login bug',
      controls: NO_CONTROLS,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'new-id', args: [...RENDERER, '--session-id', 'new-id', '--', '--help me fix the login bug'] });
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
      .toEqual([...RENDERER, '--session-id', 'new-id', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--', 'hi']);
    expect(args({ permissionMode: 'read-only' })).toEqual([...RENDERER, '--session-id', 'new-id', '--permission-mode', 'dontAsk', '--', 'hi']);
    expect(args({ permissionMode: 'safe-yolo' })).toEqual([...RENDERER, '--session-id', 'new-id', '--permission-mode', 'auto', '--', 'hi']);
  });

  it('starts in plan mode when plan was chosen, and leaves the default permissions to claude', () => {
    expect(args({ permissionMode: 'safe-yolo', agentModeId: 'plan' }))
      .toEqual([...RENDERER, '--session-id', 'new-id', '--permission-mode', 'plan', '--', 'hi']);
    expect(args({ permissionMode: 'default', agentModeId: 'build' })).toEqual([...RENDERER, '--session-id', 'new-id', '--', 'hi']);
  });

  it('reopens a conversation with the same choices', () => {
    expect(args({ modelId: 'sonnet', permissionMode: 'safe-yolo' }, 'old-id'))
      .toEqual([...RENDERER, '--resume', 'old-id', '--model', 'sonnet', '--permission-mode', 'auto']);
  });

  it('starts claude at the thinking level chosen for the model, the model\'s usual one included', () => {
    // Claude would otherwise use the level in its own settings files, which the screen does not show.
    for (const level of ['max', 'xhigh']) {
      expect(args({ modelId: 'claude-opus-5-5', configOptionOverrides: configOptionOverrides({ reasoning_effort: level }) }))
        .toEqual([...RENDERER, '--session-id', 'new-id', '--model', 'claude-opus-5-5', '--effort', level, '--', 'hi']);
    }
  });

  it('leaves the thinking level to claude when no model was chosen to check it against', () => {
    expect(args({ configOptionOverrides: configOptionOverrides({ reasoning_effort: 'max' }) }))
      .toEqual([...RENDERER, '--session-id', 'new-id', '--', 'hi']);
  });

  it('turns Ultracode on in the one settings flag claude reads, which then sets the thinking level itself', () => {
    const launched = args({
      modelId: 'claude-opus-5-5',
      configOptionOverrides: configOptionOverrides({ ultracode: 'true', reasoning_effort: 'max' }),
    });
    expect(launched.filter((arg) => arg === '--settings')).toHaveLength(1);
    expect(JSON.parse(launched[launched.indexOf('--settings') + 1] ?? '')).toEqual({ tui: 'fullscreen', ultracode: true });
    expect(launched).not.toContain('--effort');
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
