import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';

import { planClaudeNativeTerminalLaunch } from './claudeNativeTerminalLaunch';
import { runClaudeNativeTerminalSession, type NativeTerminalSessionClient } from './runClaudeNativeTerminalSession';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-terminal-'));
  dirs.push(dir);
  return dir;
}

/** The server side of a session (a network boundary): records what the runner tells it. */
function fakeServerSession() {
  const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
  let metadata: Metadata = {
    path: '/repo',
    host: 'vm',
    homeDir: '/home/u',
    happyHomeDir: '/home/u/.piggercode',
    happyLibDir: '/opt/piggercode',
    happyToolsDir: '/opt/piggercode/tools/unpacked',
  };
  const calls: string[] = [];
  const session = {
    sessionId: 'session-1',
    keepAlive: vi.fn(),
    updateMetadata: vi.fn(async (handler: (current: Metadata) => Metadata) => {
      metadata = handler(metadata);
    }),
    sendSessionDeath: vi.fn(async () => {
      calls.push('death');
    }),
    close: vi.fn(async () => {
      calls.push('close');
    }),
    rpcHandlerManager: {
      registerHandler: (method: string, handler: (raw: unknown) => Promise<unknown>) => {
        handlers.set(method, handler);
      },
    },
  };
  return {
    session: session as unknown as NativeTerminalSessionClient,
    handlers,
    calls,
    metadata: () => metadata,
  };
}

function runWith(params: Readonly<{
  server: ReturnType<typeof fakeServerSession>;
  script: string;
  cwd: string;
  transcriptPath: string;
  holdFailedExit?: (code: number) => Promise<void>;
}>) {
  const exit = vi.fn();
  const done = runClaudeNativeTerminalSession({
    session: params.server.session,
    claude: { command: '/bin/sh', args: ['-c', params.script, 'claude', '--session-id', 'c-1'] },
    claudeSessionId: 'c-1',
    cwd: params.cwd,
    env: { ...process.env, OUT: join(params.cwd, 'out.txt') },
    transcriptPath: params.transcriptPath,
    process: new EventEmitter(),
    exit,
    ...(params.holdFailedExit ? { holdFailedExit: params.holdFailedExit } : {}),
  });
  return { done, exit };
}

describe('planClaudeNativeTerminalLaunch', () => {
  it('passes claude only the conversation to start or resume', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: null,
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'new-id', args: ['--session-id', 'new-id'] });
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      transcriptExists: (id) => id === 'old-id',
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: ['--resume', 'old-id'] });
  });

  it('starts a conversation that never got a message again under its own id instead of failing to resume it', () => {
    expect(planClaudeNativeTerminalLaunch({
      resumeClaudeSessionId: 'old-id',
      transcriptExists: () => false,
      newClaudeSessionId: () => 'new-id',
    })).toEqual({ claudeSessionId: 'old-id', args: ['--session-id', 'old-id'] });
  });
});

describe('runClaudeNativeTerminalSession', () => {
  it('runs claude in the session folder, names the session after Claude\'s title, and ends the session when claude exits', async () => {
    const cwd = await tempDir();
    const transcriptPath = join(cwd, 'c-1.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Fix login', sessionId: 'c-1' })}\n`);
    const server = fakeServerSession();

    const { done, exit } = runWith({
      server,
      cwd,
      transcriptPath,
      script: 'printf "%s\\n" "$@" > "$OUT"; pwd >> "$OUT"; sleep 1',
    });
    await done;

    expect((await readFile(join(cwd, 'out.txt'), 'utf8')).trim().split('\n')).toEqual(['--session-id', 'c-1', cwd]);
    expect(server.session.keepAlive).toHaveBeenCalledWith(false, 'local');
    expect(server.metadata()).toMatchObject({
      summary: { text: 'Fix login' },
      providerSessionInfoV1: { provider: 'claude', sessionId: 'c-1', title: 'Fix login' },
    });
    expect(server.calls).toEqual(['death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('stops claude when the app stops the session', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    const { done, exit } = runWith({
      server,
      cwd,
      transcriptPath: join(cwd, 'c-1.jsonl'),
      script: 'trap "echo stopped > \\"$OUT\\"; exit 0" TERM; while :; do sleep 0.1; done',
    });

    await vi.waitFor(() => expect(server.handlers.has(RPC_METHODS.KILL_SESSION)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await server.handlers.get(RPC_METHODS.KILL_SESSION)!({});
    await done;

    expect((await readFile(join(cwd, 'out.txt'), 'utf8')).trim()).toBe('stopped');
    expect(server.calls).toEqual(['death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps a failed claude on screen until the user closes it, and never asks the daemon for a restart', async () => {
    const cwd = await tempDir();
    const server = fakeServerSession();
    let release: () => void = () => undefined;
    const holdFailedExit = vi.fn((_code: number) => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const { done, exit } = runWith({
      server,
      cwd,
      transcriptPath: join(cwd, 'c-1.jsonl'),
      script: 'exit 3',
      holdFailedExit,
    });

    await vi.waitFor(() => expect(holdFailedExit).toHaveBeenCalledWith(3));
    expect(server.calls).toEqual([]);
    release();
    await done;

    expect(server.calls).toEqual(['death', 'close']);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
