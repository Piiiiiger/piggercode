import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeTerminalActivity } from '@/terminal/nativeTerminal/nativeTerminalActivityReporter';
import { fakeServerSession, NO_CONTROLS } from '@/terminal/nativeTerminal/nativeTerminalSession.testkit';
import { openSqliteDatabaseSync } from '@/utils/sqlite/sqliteSync';

import {
  AGY_STATE_FILE_ENV_VAR,
  createAgyNativeTerminal,
  followAgyConversation,
  planAgyNativeTerminalLaunch,
  readAgyActivity,
  readAgyStateFields,
  type AgyNativeTerminalDeps,
} from './agyNativeTerminal';

const FIRST = '6f1c2a9e-1b2c-4d5e-8f90-0a1b2c3d4e5f';
const NEXT = '7a2d3b0f-2c3d-4e5f-9a01-1b2c3d4e5f60';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agy-terminal-'));
  dirs.push(dir);
  return dir;
}

/** The `--settings=` value of a launch, parsed. */
function sessionSettings(args: readonly string[]): { title?: { type?: string; enabled?: boolean; command?: string } } {
  const flag = args.find((arg) => arg.startsWith('--settings='));
  if (!flag) throw new Error('no --settings flag');
  return JSON.parse(flag.slice('--settings='.length));
}

/** Where agy's conversation index would be: absent, so titles come from the state only. */
function noIndex(statePath: string): string {
  return join(statePath, '..', 'no-index.db');
}

/**
 * agy's conversation index (its `conversation_summaries` table, the columns read here), as agy 1.5.14 keeps it: in WAL
 * mode, written by agy while sessions read it.
 */
function agyIndex(path: string) {
  const db = openSqliteDatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text NOT NULL DEFAULT "")');
  return {
    name: (conversationId: string, title: string) => {
      db.prepare('INSERT INTO conversation_summaries (conversation_id, title) VALUES (?, ?) ON CONFLICT(conversation_id) DO UPDATE SET title = excluded.title')
        .run(conversationId, title);
    },
    /** agy folding its write-ahead log back into the database; `busy` is 1 when a reader holds it up. */
    checkpoint: () => db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number },
    close: () => db.close(),
  };
}

/** What agy writes for its title command: the state it shows (agy 1.5.14's status line payload). */
async function showState(statePath: string, state: Record<string, unknown>): Promise<void> {
  // agy's command replaces the file whole, as the one the launch gives it does.
  await writeFile(`${statePath}.tmp`, JSON.stringify(state));
  await rename(`${statePath}.tmp`, statePath);
}

describe('planAgyNativeTerminalLaunch', () => {
  it('starts a new conversation, with the text typed in the new-session screen as its first prompt', () => {
    const plain = planAgyNativeTerminalLaunch({ resumeConversationId: null, firstPrompt: null, controls: NO_CONTROLS });
    expect(plain.conversationId).toBeNull();
    expect(plain.args.filter((arg) => !arg.startsWith('--settings='))).toEqual([]);

    // A prompt that starts with a dash stays the flag's value.
    const prompted = planAgyNativeTerminalLaunch({ resumeConversationId: null, firstPrompt: '-v fix the login bug', controls: NO_CONTROLS });
    expect(prompted.args.filter((arg) => !arg.startsWith('--settings='))).toEqual(['--prompt-interactive=-v fix the login bug']);
  });

  it('reopens the conversation the session had, with the text typed for it as the next prompt', () => {
    const launch = planAgyNativeTerminalLaunch({ resumeConversationId: ` ${FIRST} `, firstPrompt: null, controls: NO_CONTROLS });
    expect(launch.conversationId).toBe(FIRST);
    expect(launch.args.filter((arg) => !arg.startsWith('--settings='))).toEqual([`--conversation=${FIRST}`]);

    const prompted = planAgyNativeTerminalLaunch({ resumeConversationId: FIRST, firstPrompt: 'go on', controls: NO_CONTROLS });
    expect(prompted.args.filter((arg) => !arg.startsWith('--settings='))).toEqual([`--conversation=${FIRST}`, '--prompt-interactive=go on']);
  });

  it('starts agy with the model and Thinking level chosen for the session, avoiding conflicts with suffixed ids and leaving default to agy itself', () => {
    expect(planAgyNativeTerminalLaunch({
      resumeConversationId: null,
      firstPrompt: null,
      controls: { ...NO_CONTROLS, modelId: 'gemini-4-neon' },
    }).args.filter((arg) => !arg.startsWith('--settings='))).toEqual(['--model=gemini-4-neon']);

    expect(planAgyNativeTerminalLaunch({
      resumeConversationId: null,
      firstPrompt: null,
      controls: {
        ...NO_CONTROLS,
        modelId: 'gemini-4-neon',
        configOptionOverrides: {
          v: 1,
          updatedAt: 1,
          overrides: { reasoning_effort: { updatedAt: 1, value: 'xhigh' } },
        },
      },
    }).args.filter((arg) => !arg.startsWith('--settings='))).toEqual(['--model=gemini-4-neon', '--effort=xhigh']);

    // An id that already carries an effort suffix (e.g. a single-variant model or legacy favorite) must not also pass --effort, which agy rejects.
    expect(planAgyNativeTerminalLaunch({
      resumeConversationId: null,
      firstPrompt: null,
      controls: {
        ...NO_CONTROLS,
        modelId: 'gemini-4-neon-high',
        configOptionOverrides: {
          v: 1,
          updatedAt: 1,
          overrides: { reasoning_effort: { updatedAt: 1, value: 'low' } },
        },
      },
    }).args.filter((arg) => !arg.startsWith('--settings='))).toEqual(['--model=gemini-4-neon-high']);

    expect(planAgyNativeTerminalLaunch({
      resumeConversationId: null,
      firstPrompt: null,
      controls: {
        ...NO_CONTROLS,
        modelId: 'default',
        configOptionOverrides: {
          v: 1,
          updatedAt: 1,
          overrides: { reasoning_effort: { updatedAt: 1, value: 'high' } },
        },
      },
    }).args.filter((arg) => !arg.startsWith('--settings='))).toEqual([]);

    expect(planAgyNativeTerminalLaunch({
      resumeConversationId: null,
      firstPrompt: null,
      controls: {
        ...NO_CONTROLS,
        modelId: 'gemini-4-neon',
        configOptionOverrides: {
          v: 1,
          updatedAt: 1,
          overrides: { reasoning_effort: { updatedAt: 1, value: 'bogus' } },
        },
      },
    }).args.filter((arg) => !arg.startsWith('--settings='))).toEqual(['--model=gemini-4-neon']);
  });

  it('starts agy with the permission chosen in the new-session screen, as agy\'s own mode', () => {
    const argsFor = (permissionMode: (typeof NO_CONTROLS)['permissionMode']) => planAgyNativeTerminalLaunch({
      resumeConversationId: null,
      firstPrompt: null,
      controls: { ...NO_CONTROLS, permissionMode },
    }).args.filter((arg) => !arg.startsWith('--settings='));
    // `default` leaves the user's own agy setting in charge.
    expect(argsFor('default')).toEqual([]);
    expect(argsFor(null)).toEqual([]);
    expect(argsFor('read-only')).toEqual(['--mode=plan']);
    expect(argsFor('plan')).toEqual(['--mode=plan']);
    expect(argsFor('safe-yolo')).toEqual(['--mode=auto']);
    expect(argsFor('acceptEdits')).toEqual(['--mode=auto']);
    expect(argsFor('yolo')).toEqual(['--dangerously-skip-permissions']);
    expect(argsFor('bypassPermissions')).toEqual(['--dangerously-skip-permissions']);
  });

  it('gives agy, new or reopened, a title command that keeps the state it shows in the session\'s file', async () => {
    for (const resumeConversationId of [null, FIRST]) {
      const settings = sessionSettings(planAgyNativeTerminalLaunch({ resumeConversationId, firstPrompt: 'hi', controls: NO_CONTROLS }).args);
      expect(settings.title?.type).toBe('command');
      expect(settings.title?.enabled).toBe(true);
      const command = settings.title?.command;
      expect(typeof command).toBe('string');

      // agy runs it with `sh -c`, the state as JSON on stdin, in its own environment.
      const statePath = join(await tempDir(), 'state.json');
      const state = JSON.stringify({ conversation_id: FIRST, agent_state: 'working' });
      const run = spawnSync('sh', ['-c', command!], {
        input: state,
        env: { ...process.env, [AGY_STATE_FILE_ENV_VAR]: statePath },
        encoding: 'utf8',
      });
      expect(run.status).toBe(0);
      // It prints nothing, so agy leaves the window title alone.
      expect(run.stdout).toBe('');
      expect(await readFile(statePath, 'utf8')).toBe(state);
    }
  });
});

describe('readAgyActivity', () => {
  // States agy 1.5.14 documents for its status line payload (`agent_state`, `tool_confirmation_pending`, `task_count`).
  it('reads what agy shows: a turn in progress, a confirmation it waits for, or its input box', () => {
    expect(readAgyActivity({ agent_state: 'working' })).toEqual({ kind: 'working' });
    expect(readAgyActivity({ agent_state: 'tool_use' })).toEqual({ kind: 'working' });
    expect(readAgyActivity({ agent_state: 'tool_use', tool_confirmation_pending: true })).toEqual({ kind: 'waiting', on: 'permission' });
    expect(readAgyActivity({ agent_state: 'idle' })).toEqual({ kind: 'idle' });
    expect(readAgyActivity({ agent_state: 'idle', task_count: 2 })).toEqual({ kind: 'idle', background: true });
  });

  it('tells nothing for a state it does not know', () => {
    expect(readAgyActivity({ agent_state: 'initializing' })).toBeNull();
    expect(readAgyActivity({ agent_state: 'authenticating' })).toBeNull();
    expect(readAgyActivity({})).toBeNull();
    expect(readAgyActivity(null)).toBeNull();
    expect(readAgyActivity('idle')).toBeNull();
  });
});

describe('followAgyConversation', () => {
  it('hands over the account limits agy writes', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    const readings: unknown[] = [];
    const stop = followAgyConversation({
      session: server.session,
      statePath,
      conversationIndexPath: noIndex(statePath),
      initialConversationId: null,
      reportAccountUsage: (reading) => readings.push(reading),
      intervalMs: 10,
    });
    try {
      await showState(statePath, {
        conversation_id: '',
        agent_state: 'idle',
        email: 'someone@example.com',
        quota: { 'gemini-5h': { remaining_fraction: 0.5, reset_time: '2026-11-23T17:00:27Z' } },
      });
      await vi.waitFor(() => expect(readings).toEqual([{
        email: 'someone@example.com',
        planTier: null,
        meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: Date.parse('2026-11-23T17:00:27Z') }],
      }]));
    } finally {
      await stop();
    }
  });

  it('records the conversation agy shows and its title, reports what agy shows, and follows it to the next', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    const reported: NativeTerminalActivity[] = [];
    const stop = followAgyConversation({
      session: server.session,
      statePath,
      conversationIndexPath: noIndex(statePath),
      initialConversationId: null,
      reportActivity: (activity) => reported.push(activity),
      intervalMs: 10,
    });
    try {
      // Before agy starts there is no state: what it shows is unknown.
      await vi.waitFor(() => expect(reported).toEqual([{ kind: 'unknown' }]));

      // agy's input box, before the first prompt starts a conversation.
      await showState(statePath, { conversation_id: '', agent_state: 'idle' });
      await vi.waitFor(() => expect(reported.at(-1)).toEqual({ kind: 'idle' }));
      expect(server.metadata().agySessionId).toBeUndefined();

      await showState(statePath, { conversation_id: FIRST, agent_state: 'working' });
      await vi.waitFor(() => expect(reported.at(-1)).toEqual({ kind: 'working' }));
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ agySessionId: FIRST }));

      await showState(statePath, { conversation_id: FIRST, conversation_title: 'Fix login', agent_state: 'idle' });
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        agySessionId: FIRST,
        summary: { text: 'Fix login' },
        providerSessionInfoV1: { provider: 'agy', sessionId: FIRST, title: 'Fix login' },
      }));
      expect(reported.at(-1)).toEqual({ kind: 'idle' });

      // `/clear` (or `/resume`) inside the terminal: agy shows another conversation.
      await showState(statePath, { conversation_id: NEXT, conversation_title: 'Release notes', agent_state: 'idle' });
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        agySessionId: NEXT,
        summary: { text: 'Release notes' },
      }));
    } finally {
      await stop();
    }
  });

  it('names the session after the title agy gives the conversation in its index, which no state change brings', async () => {
    const dir = await tempDir();
    const statePath = join(dir, 'state.json');
    const index = agyIndex(join(dir, 'conversation_summaries.db'));
    const server = fakeServerSession();
    const stop = followAgyConversation({
      session: server.session,
      statePath,
      conversationIndexPath: join(dir, 'conversation_summaries.db'),
      initialConversationId: null,
      intervalMs: 10,
    });
    try {
      // agy opens the conversation as it starts; it has no title yet.
      await showState(statePath, { conversation_id: FIRST, agent_state: 'idle' });
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ agySessionId: FIRST }));
      expect(server.metadata().summary).toBeUndefined();

      // Some seconds after the first turn, agy names it in its index only.
      index.name(FIRST, 'Create Hello File');
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({
        summary: { text: 'Create Hello File' },
        providerSessionInfoV1: { provider: 'agy', sessionId: FIRST, title: 'Create Hello File' },
      }));

      // `/rename` puts the new title in both.
      index.name(FIRST, 'My agy test');
      await showState(statePath, { conversation_id: FIRST, conversation_title: 'My agy test', agent_state: 'idle' });
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ summary: { text: 'My agy test' } }));

      // The session keeps the index open between reads without holding agy's checkpoints up.
      expect(index.checkpoint().busy).toBe(0);
    } finally {
      await stop();
      index.close();
    }
  });

  it('keeps a reopened conversation, writing it only once, and takes its renames', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    await server.session.updateMetadata((metadata) => ({ ...metadata, agySessionId: FIRST }));
    const metadataWrites = vi.mocked(server.session.updateMetadata);
    metadataWrites.mockClear();
    const stop = followAgyConversation({
      session: server.session,
      statePath,
      conversationIndexPath: noIndex(statePath),
      initialConversationId: FIRST,
      intervalMs: 10,
    });
    try {
      await showState(statePath, { conversation_id: FIRST, conversation_title: 'Fix login', agent_state: 'idle' });
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ summary: { text: 'Fix login' } }));
      await showState(statePath, { conversation_id: FIRST, conversation_title: 'Fix the login page', agent_state: 'idle' });
      await vi.waitFor(() => expect(server.metadata()).toMatchObject({ summary: { text: 'Fix the login page' } }));
      // Only the titles were written: the conversation was recorded before agy started.
      expect(metadataWrites).toHaveBeenCalledTimes(2);
      expect(server.metadata().agySessionId).toBe(FIRST);
    } finally {
      await stop();
    }
  });

  it('records a conversation agy switched to just before it quit', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    const stop = followAgyConversation({ session: server.session, statePath, conversationIndexPath: noIndex(statePath), initialConversationId: null, intervalMs: 10 });
    await showState(statePath, { conversation_id: FIRST, agent_state: 'idle' });
    await vi.waitFor(() => expect(server.metadata()).toMatchObject({ agySessionId: FIRST }));

    // `/clear`, a first prompt and `/exit` within one read interval.
    await showState(statePath, { conversation_id: NEXT, conversation_title: 'Release notes', agent_state: 'idle' });
    await stop();

    expect(server.metadata()).toMatchObject({ agySessionId: NEXT, summary: { text: 'Release notes' } });
  });

  it('records the conversation agy quit on after an older write ends, even when the relay rejects its first try', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    const writeMetadata = vi.mocked(server.session.updateMetadata);
    const relay = writeMetadata.getMockImplementation()!;
    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    writeMetadata
      .mockImplementationOnce(async (handler) => {
        await firstHeld;
        await relay(handler);
      })
      .mockImplementationOnce(async () => {
        throw new Error('relay away');
      });
    // The older write ends only once the stopper has read the last state.
    let stopping = false;
    const readState = async (path: string): Promise<string> => {
      const last = stopping;
      const raw = await readFile(path, 'utf8');
      if (last) releaseFirst();
      return raw;
    };
    const stop = followAgyConversation({ session: server.session, statePath, conversationIndexPath: noIndex(statePath), initialConversationId: null, readState, intervalMs: 10 });
    await showState(statePath, { conversation_id: FIRST, agent_state: 'idle' });
    await vi.waitFor(() => expect(writeMetadata).toHaveBeenCalledTimes(1));
    await showState(statePath, { conversation_id: NEXT, agent_state: 'idle' });

    stopping = true;
    await stop();

    expect(server.metadata()).toMatchObject({ agySessionId: NEXT });
  });

  it('keeps reporting what agy shows while the relay has not yet taken a write', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    let releaseWrite: () => void = () => {};
    const heldWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeMetadata = vi.mocked(server.session.updateMetadata);
    const relay = writeMetadata.getMockImplementation()!;
    // The relay takes the first write only when released (slow, not failed).
    writeMetadata.mockImplementationOnce(async (handler) => {
      await heldWrite;
      await relay(handler);
    });
    const reported: NativeTerminalActivity[] = [];
    const stop = followAgyConversation({
      session: server.session,
      statePath,
      conversationIndexPath: noIndex(statePath),
      initialConversationId: null,
      reportActivity: (activity) => reported.push(activity),
      intervalMs: 10,
    });
    try {
      await showState(statePath, { conversation_id: FIRST, agent_state: 'idle' });
      await vi.waitFor(() => expect(writeMetadata).toHaveBeenCalledTimes(1));
      await showState(statePath, { conversation_id: FIRST, agent_state: 'tool_use', tool_confirmation_pending: true });
      await vi.waitFor(() => expect(reported.at(-1)).toEqual({ kind: 'waiting', on: 'permission' }));
    } finally {
      releaseWrite();
      await stop();
    }
    // The held write lands once the relay answers.
    expect(server.metadata()).toMatchObject({ agySessionId: FIRST });
  });

  it('takes an unreadable state as unknown, and the next whole one as what agy shows', async () => {
    const statePath = join(await tempDir(), 'state.json');
    const server = fakeServerSession();
    const reported: NativeTerminalActivity[] = [];
    const stop = followAgyConversation({
      session: server.session,
      statePath,
      conversationIndexPath: noIndex(statePath),
      initialConversationId: null,
      reportActivity: (activity) => reported.push(activity),
      intervalMs: 10,
    });
    try {
      await showState(statePath, { conversation_id: FIRST, agent_state: 'working' });
      await vi.waitFor(() => expect(reported.at(-1)).toEqual({ kind: 'working' }));
      await writeFile(statePath, '{"conversation_id": "');
      await vi.waitFor(() => expect(reported.at(-1)).toEqual({ kind: 'unknown' }));
      await showState(statePath, { conversation_id: FIRST, agent_state: 'working' });
      await vi.waitFor(() => expect(reported.at(-1)).toEqual({ kind: 'working' }));
    } finally {
      await stop();
    }
  });
});

describe('readAgyStateFields', () => {
  it('reads the conversation, the model when agy names one, and what agy shows', () => {
    expect(readAgyStateFields({ conversation_id: ` ${FIRST} `, agent_state: 'idle', model: 'gemini-4-neon-high' })).toEqual({
      conversationId: FIRST,
      modelId: 'gemini-4-neon-high',
      activity: { kind: 'idle' },
      agentState: 'idle',
    });
    expect(readAgyStateFields({ conversation_id: '', agent_state: 'working', model: { id: 'claude-opus-4-5' } })).toEqual({
      conversationId: null,
      modelId: 'claude-opus-4-5',
      activity: { kind: 'working' },
      agentState: 'working',
    });
    expect(readAgyStateFields(null)).toEqual({ conversationId: null, modelId: null, activity: null, agentState: null });
  });
});

describe('agy native terminal launch on a login', () => {
  const planArgs = { directory: '/repo', resumeId: null, firstPrompt: null, controls: NO_CONTROLS };

  async function setup(over: Partial<AgyNativeTerminalDeps> = {}) {
    const home = await tempDir();
    const deps: AgyNativeTerminalDeps = {
      requestLaunchAccount: vi.fn(async () => ({ ok: true as const, accountId: 'default', accountHomeDir: null, unavailable: [] })),
      sendAccountSession: vi.fn(async () => ({ ok: true as const })),
      sendUsage: vi.fn(async () => undefined),
      createPane: () => null,
      realHomeDir: () => home,
      resolveAgy: () => ({ command: '/opt/agy', args: [] }),
      ...over,
    };
    return { home, deps, provider: createAgyNativeTerminal(deps) };
  }

  it('starts agy as it always did on the default login, and tells the daemon the model it asks for', async () => {
    const { deps, provider } = await setup();
    const launch = await provider.planLaunch({ ...planArgs, controls: { ...NO_CONTROLS, modelId: 'gemini-4-neon-high' } });
    expect(launch.cli.command).toBe('/opt/agy');
    expect(launch.cli.args).toContain('--model=gemini-4-neon-high');
    expect(deps.requestLaunchAccount).toHaveBeenCalledWith({ runnerKey: expect.any(String), modelId: 'gemini-4-neon-high' });
    expect(launch.switcher).toBeDefined();
  });

  it('wraps agy in the login namespace for another login, binding only its two login locations', async () => {
    const { home, provider } = await setup({
      requestLaunchAccount: async () => ({ ok: true as const, accountId: 'b', accountHomeDir: '/logins/b', unavailable: [] }),
    });
    const launch = await provider.planLaunch({ ...planArgs, resumeId: FIRST });
    expect(launch.cli.command).toBe('unshare');
    expect(launch.cli.args).toContain('/logins/b');
    expect(launch.cli.args).toContain(`--conversation=${FIRST}`);
    expect(launch.cli.args[launch.cli.args.indexOf('/logins/b') + 1]).toBe('/opt/agy');
    // The real home gets what the login's files are bound over; its conversations are not touched.
    await launch.beforeStart!();
    expect(await readFile(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 'utf8')).toBe('');
    await rm(launch.env[AGY_STATE_FILE_ENV_VAR]!.replace(/state\.json$/, ''), { recursive: true, force: true });
  });

  it('starts on the default login when the daemon does not answer', async () => {
    const { provider } = await setup({ requestLaunchAccount: async () => ({ error: 'No daemon running' }) });
    const launch = await provider.planLaunch(planArgs);
    expect(launch.cli.command).toBe('/opt/agy');
  });

  it('files what agy reports under the login it runs on, with the runner and the process count', async () => {
    const { deps, provider } = await setup({
      requestLaunchAccount: vi.fn(async () => ({ ok: true as const, accountId: 'b', accountHomeDir: '/logins/b', unavailable: [] })),
    });
    const launch = await provider.planLaunch(planArgs);
    await launch.beforeStart!();
    const statePath = launch.env[AGY_STATE_FILE_ENV_VAR]!;
    await showState(statePath, {
      conversation_id: FIRST,
      agent_state: 'idle',
      quota: { 'gemini-5h': { remaining_fraction: 0.5, reset_time: '2026-11-23T17:00:27Z' } },
    });
    const started = vi.fn();
    const stop = launch.follow({ session: fakeServerSession().session, childPid: null, reportActivity: () => undefined, reportStarted: started });
    try {
      await vi.waitFor(() => expect(deps.sendUsage).toHaveBeenCalledTimes(1));
      expect(started).toHaveBeenCalledTimes(1);
      const asked = (deps.requestLaunchAccount as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { runnerKey: string };
      expect(deps.sendUsage).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'b', runnerKey: asked.runnerKey, childEpoch: 1 }));
    } finally {
      await stop();
    }
  });
});

describe('followAgyConversation started and sign-in', () => {
  async function run(states: ReadonlyArray<Record<string, unknown>>, options: Readonly<{ authenticatingCounts?: boolean }> = {}) {
    const statePath = join(await tempDir(), 'state.json');
    const onStarted = vi.fn();
    const onAuthenticating = vi.fn();
    const onState = vi.fn();
    const stop = followAgyConversation({
      session: fakeServerSession().session,
      statePath,
      conversationIndexPath: noIndex(statePath),
      initialConversationId: null,
      onStarted,
      onAuthenticating,
      onState,
      ...(options.authenticatingCounts ? { authenticatingCounts: true } : {}),
      intervalMs: 10,
    });
    try {
      for (const state of states) {
        const before = onState.mock.calls.length;
        await showState(statePath, state);
        await vi.waitFor(() => expect(onState.mock.calls.length).toBeGreaterThan(before));
      }
    } finally {
      await stop();
    }
    return { onStarted, onAuthenticating };
  }

  it('is started once agy leaves initializing, not before', async () => {
    const early = await run([{ agent_state: 'initializing', conversation_id: '' }]);
    expect(early.onStarted).not.toHaveBeenCalled();
    const both = await run([{ agent_state: 'initializing', conversation_id: '' }, { agent_state: 'idle', conversation_id: FIRST }, { agent_state: 'working', conversation_id: FIRST }]);
    expect(both.onStarted).toHaveBeenCalledTimes(1);
    expect(both.onAuthenticating).not.toHaveBeenCalled();
  });

  it('is not started on agy\'s sign-in screen, and says so once', async () => {
    const result = await run([{ agent_state: 'authenticating', conversation_id: '', email: null }, { agent_state: 'authenticating', conversation_id: '', email: null, x: 1 }]);
    expect(result.onStarted).not.toHaveBeenCalled();
    expect(result.onAuthenticating).toHaveBeenCalledTimes(1);
  });

  it('keeps today\'s behaviour for the default login, whose sign-in screen is the owner\'s to use', async () => {
    const result = await run([{ agent_state: 'authenticating', conversation_id: '' }], { authenticatingCounts: true });
    expect(result.onStarted).toHaveBeenCalledTimes(1);
    expect(result.onAuthenticating).not.toHaveBeenCalled();
  });
});
