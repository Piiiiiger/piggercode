import { describe, expect, it } from 'vitest';

import { createTerminalPtySessionManager, type TerminalPtySessionManagerConfig } from './terminalPtySessionManager';
import type { Disposable, PtyExitEvent, PtyProcess, PtyProvider, PtySpawnParams } from '@/integrations/pty/ptyProvider';

function createFakeDisposable(): Disposable {
  return { dispose: () => { } };
}

class FakePty implements PtyProcess {
  public readonly writes: string[] = [];
  public readonly resizes: Array<Readonly<{ cols: number; rows: number }>> = [];
  private readonly onDataListeners = new Set<(data: string) => void>();
  private readonly onExitListeners = new Set<(e: PtyExitEvent) => void>();

  constructor(private readonly resizeError?: Error) {}

  write(data: string): void {
    this.writes.push(String(data));
  }

  resize(cols: number, rows: number): void {
    if (this.resizeError) throw this.resizeError;
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    // noop
  }

  onData(listener: (data: string) => void): Disposable {
    this.onDataListeners.add(listener);
    return createFakeDisposable();
  }

  onExit(listener: (e: PtyExitEvent) => void): Disposable {
    this.onExitListeners.add(listener);
    return createFakeDisposable();
  }

  emitData(data: string): void {
    for (const listener of this.onDataListeners) {
      listener(data);
    }
  }

  emitExit(e: PtyExitEvent): void {
    for (const listener of this.onExitListeners) {
      listener(e);
    }
  }
}

class FakePtyProvider implements PtyProvider {
  public readonly spawned: Array<{ params: PtySpawnParams; pty: FakePty }> = [];

  constructor(private readonly createPty: () => FakePty = () => new FakePty()) {}

  spawn(params: PtySpawnParams): PtyProcess {
    const pty = this.createPty();
    this.spawned.push({ params, pty });
    return pty;
  }
}

function defaultConfig(overrides?: Partial<TerminalPtySessionManagerConfig>): TerminalPtySessionManagerConfig {
  return {
    maxSessions: 10,
    idleTimeoutMs: 60_000,
    bufferMaxBytes: 1_000_000,
    bufferMaxEvents: 1000,
    urlParseBufferLimit: 32_768,
    maxWriteChunkBytes: 16_384,
    defaultCols: 80,
    defaultRows: 24,
    ...overrides,
  };
}

describe('TerminalPtySessionManager', () => {
  it('reuses sessions by terminalKey', () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      now: () => 0,
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });

    const first = manager.ensure({ terminalKey: 'k1', cwd: '/tmp', cols: 80, rows: 24 });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected ok');

    const second = manager.ensure({ terminalKey: 'k1', cwd: '/tmp', cols: 81, rows: 25 });
    expect(second).toEqual({ ok: true, terminalId: first.terminalId, reused: true });
  });

  it('reports resize-unavailable without recording unsupported dimensions', () => {
    const provider = new FakePtyProvider(() => new FakePty(new Error('terminal_resize_unavailable')));
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      now: () => 0,
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });

    const ensured = manager.ensure({ terminalKey: 'k-resize', cwd: '/tmp', cols: 80, rows: 24 });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) throw new Error('expected ok');

    expect(manager.resize({ terminalId: ensured.terminalId, cols: 120, rows: 40 })).toEqual({
      ok: false,
      errorCode: 'terminal_resize_unavailable',
      error: 'terminal_resize_unavailable',
    });
    expect(manager.ensure({ terminalKey: 'k-resize', cwd: '/tmp' })).toEqual({
      ok: true,
      terminalId: ensured.terminalId,
      reused: true,
    });
    expect(provider.spawned[0]?.pty.resizes).toEqual([]);
  });

  it('streams PTY output via cursor reads', async () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig({ bufferMaxEvents: 10 }),
      now: () => 0,
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });

    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp', cols: 80, rows: 24 });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) throw new Error('expected ok');
    const pty = provider.spawned[0]?.pty;
    if (!pty) throw new Error('missing fake pty');

    pty.emitData('hello');

    const read1 = await manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10 });
    expect(read1.ok).toBe(true);
    if (!read1.ok) throw new Error('expected ok');
    expect(read1.events).toEqual([{ t: 'data', data: 'hello' }]);
    expect(read1.nextCursor).toBe(1);

    const read2 = await manager.read({ terminalId: ensured.terminalId, cursor: read1.nextCursor, maxBytes: 1024, maxEvents: 10 });
    expect(read2.ok).toBe(true);
    if (!read2.ok) throw new Error('expected ok');
    expect(read2.events).toEqual([]);
    expect(read2.nextCursor).toBe(1);
  });

  it('suppresses zsh prompt EOL markers in embedded terminal sessions by default', () => {
    const provider = new FakePtyProvider();
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/zsh' };
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      now: () => 0,
      env,
      platform: 'darwin',
    });

    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp' });
    expect(ensured.ok).toBe(true);

    const spawnedEnv = provider.spawned[0]?.params.options.env;
    expect(provider.spawned[0]?.params.args).toEqual(['-l', '+o', 'prompt_sp']);
    expect(spawnedEnv).toMatchObject({
      SHELL: '/bin/zsh',
      PROMPT_EOL_MARK: '',
    });
    expect(env.PROMPT_EOL_MARK).toBeUndefined();
  });

  it('uses the configured zsh prompt EOL marker override when provided', () => {
    const provider = new FakePtyProvider();
    const env: NodeJS.ProcessEnv = {
      SHELL: '/bin/zsh',
      PIGGERCODE_DAEMON_TERMINAL_PROMPT_EOL_MARK: 'marker',
    };
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      now: () => 0,
      env,
      platform: 'darwin',
    });

    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp' });
    expect(ensured.ok).toBe(true);

    expect(provider.spawned[0]?.params.args).toEqual(['-l']);
    expect(provider.spawned[0]?.params.options.env).toMatchObject({
      SHELL: '/bin/zsh',
      PIGGERCODE_DAEMON_TERMINAL_PROMPT_EOL_MARK: 'marker',
      PROMPT_EOL_MARK: 'marker',
    });
  });

  it('holds a read open until output arrives, so typing echoes at once, and answers empty when the wait ends', async () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });
    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp', cols: 80, rows: 24 });
    if (!ensured.ok) throw new Error('expected ok');
    const pty = provider.spawned[0]?.pty;
    if (!pty) throw new Error('missing fake pty');

    const startedAt = Date.now();
    const waiting = manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10, waitMs: 10_000 });
    setTimeout(() => pty.emitData('echo'), 20);
    expect(await waiting).toMatchObject({ ok: true, events: [{ t: 'data', data: 'echo' }], nextCursor: 1 });
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    expect(await manager.read({ terminalId: ensured.terminalId, cursor: 1, maxBytes: 1024, maxEvents: 10, waitMs: 50 }))
      .toMatchObject({ ok: true, events: [], nextCursor: 1, waited: true });
  });

  it('never counts a terminal someone is waiting to read as idle', async () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig({ idleTimeoutMs: 20 }),
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });
    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp', cols: 80, rows: 24 });
    if (!ensured.ok) throw new Error('expected ok');

    expect(await manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10, waitMs: 100 }))
      .toMatchObject({ ok: true, events: [], waited: true });
    expect(await manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10 }))
      .toMatchObject({ ok: true });
  });

  it('ends a held read when the terminal closes', async () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });
    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp', cols: 80, rows: 24 });
    if (!ensured.ok) throw new Error('expected ok');

    const startedAt = Date.now();
    const waiting = manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10, waitMs: 10_000 });
    setTimeout(() => manager.close({ terminalId: ensured.terminalId }), 20);
    expect(await waiting).toMatchObject({ ok: false, errorCode: 'terminal_not_found' });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('emits a gap event when the cursor is too old', async () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig({ bufferMaxEvents: 2 }),
      now: () => 0,
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });

    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp' });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) throw new Error('expected ok');
    const pty = provider.spawned[0]?.pty;
    if (!pty) throw new Error('missing fake pty');

    pty.emitData('a');
    pty.emitData('b');
    pty.emitData('c');

    const read = await manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10 });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('expected ok');
    expect(read.events).toEqual([
      { t: 'gap', droppedBefore: 1 },
      { t: 'data', data: 'b' },
      { t: 'data', data: 'c' },
    ]);
    expect(read.nextCursor).toBe(3);
  });

  it('appends an exit event and marks done when caught up', async () => {
    const provider = new FakePtyProvider();
    const manager = createTerminalPtySessionManager({
      ptyProvider: provider,
      config: defaultConfig(),
      now: () => 0,
      env: { SHELL: '/bin/bash' },
      platform: 'linux',
    });

    const ensured = manager.ensure({ terminalKey: 'k1', cwd: '/tmp' });
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) throw new Error('expected ok');
    const pty = provider.spawned[0]?.pty;
    if (!pty) throw new Error('missing fake pty');

    pty.emitExit({ exitCode: 0, signal: 0 });

    const read1 = await manager.read({ terminalId: ensured.terminalId, cursor: 0, maxBytes: 1024, maxEvents: 10 });
    expect(read1.ok).toBe(true);
    if (!read1.ok) throw new Error('expected ok');
    expect(read1.events).toEqual([{ t: 'exit', exitCode: 0, signal: 0 }]);
    expect(read1.done).toBe(true);
  });
});
