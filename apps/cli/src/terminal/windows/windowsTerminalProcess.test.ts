import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import {
  buildPowerShellStartWindowsTerminalInvocation,
  startProcessInWindowsTerminal,
} from './windowsTerminalProcess';

type SpawnMockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
};

function createFakeChildProcess(): SpawnMockChild {
  const child = new EventEmitter() as SpawnMockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe('buildPowerShellStartWindowsTerminalInvocation', () => {
  it('escapes Windows Terminal command delimiters in every argv field', () => {
    const invocation = buildPowerShellStartWindowsTerminalInvocation({
      windowId: 'window;one',
      title: 'title;two',
      workingDirectory: 'C:\\repo;three',
      filePath: 'C:\\tools;four\\piggercode.exe',
      args: ['arg;five'],
    });

    const script = invocation.args.at(-1) ?? '';
    expect(script).toContain('window\\;one');
    expect(script).toContain('title\\;two');
    expect(script).toContain('repo\\;three');
    expect(script).toContain('tools\\;four');
    expect(script).toContain('arg\\;five');
    expect(script).not.toContain('window;one');
  });

  it('quotes the Windows Terminal command line so paths and arguments with spaces stay intact', () => {
    const invocation = buildPowerShellStartWindowsTerminalInvocation({
      filePath: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'apps\\cli\\package-dist\\index.mjs',
        'claude',
        '--prompt',
        'prompt with spaces',
        'quote"inside',
      ],
      workingDirectory: 'C:\\Users\\test qa\\repo',
      windowId: 'piggercode qa',
      title: 'PiggerCode Claude Session',
    });

    const script = invocation.args.at(-1) ?? '';

    expect(script).toContain(
      "-ArgumentList '-w \"piggercode qa\" new-tab --title \"PiggerCode Claude Session\" --startingDirectory \"C:\\Users\\test qa\\repo\" \"C:\\Program Files\\nodejs\\node.exe\" apps\\cli\\package-dist\\index.mjs claude --prompt \"prompt with spaces\" \"quote\\\"inside\"'",
    );
  });
});

describe('startProcessInWindowsTerminal', () => {
  const originalPath = process.env.Path;

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.PIGGERCODE_WINDOWS_TERMINAL_SECRET_PROBE;
    if (originalPath === undefined) {
      delete process.env.Path;
    } else {
      process.env.Path = originalPath;
    }
  });

  it('can launch with a minimal Windows host environment plus explicit child env', async () => {
    process.env.PIGGERCODE_WINDOWS_TERMINAL_SECRET_PROBE = 'must-not-leak';
    process.env.Path = 'C:\\Windows\\System32;C:\\Tools';
    const child = createFakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);

    const params: Parameters<typeof startProcessInWindowsTerminal>[0] & { inheritParentEnv: false } = {
      workingDirectory: 'C:\\repo',
      env: { ZELLIJ_SOCKET_DIR: 'C:\\Temp\\zellij' },
      filePath: 'C:\\Tools\\zellij.exe',
      args: ['attach', '--create', 'happy-claude'],
      windowId: 'happier-zellij',
      title: 'PiggerCode Claude happy-claude',
      inheritParentEnv: false,
    };
    const pending = startProcessInWindowsTerminal(params);

    child.stdout.emit('data', Buffer.from('12345\r\n'));
    child.emit('close', 0);

    await expect(pending).resolves.toEqual({ ok: true, pid: 12345 });

    const options = vi.mocked(spawn).mock.calls[0]?.[2] as SpawnOptions | undefined;
    expect(options?.env?.ZELLIJ_SOCKET_DIR).toBe('C:\\Temp\\zellij');
    expect(options?.env?.Path ?? options?.env?.PATH).toBe('C:\\Windows\\System32;C:\\Tools');
    expect(options?.env?.PIGGERCODE_WINDOWS_TERMINAL_SECRET_PROBE).toBeUndefined();
  });
});
