import { stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGY_STATE_FILE_ENV_VAR } from '@/backends/agy/nativeTerminal/agyNativeTerminal';

import { probeAgyAccountUsage } from './probeAgyAccountUsage';

const STATUS = {
  email: 'someone@example.com',
  plan_tier: 'pro',
  quota: { 'gemini-5h': { remaining_fraction: 0.5, reset_time: '2026-11-24T17:00:27Z' } },
};
const AGY = { command: 'agy', args: [] };
const PANE_PID = 4242;

type Call = Readonly<{ args: readonly string[]; env: NodeJS.ProcessEnv }>;

/** tmux and the process table are the boundary: `started` plays agy. */
function fakeTmux(started?: (call: Call, quit: () => void) => void | Promise<void>) {
  const calls: Call[] = [];
  const running = new Set([PANE_PID]);
  const quit = () => running.delete(PANE_PID);
  const runTmux = async (args: readonly string[], env: NodeJS.ProcessEnv) => {
    const call = { args, env };
    calls.push(call);
    if (args.includes('new-session')) {
      setImmediate(() => void started?.(call, quit));
      return `${PANE_PID}\n`;
    }
    if (args.includes('kill-server')) quit();
    return '';
  };
  return { calls, runTmux, isRunning: (pid: number) => running.has(pid), running };
}

const writesStatus = async (call: Call) => {
  await writeFile(String(call.env[AGY_STATE_FILE_ENV_VAR]), JSON.stringify(STATUS));
};

const options = { homeDir: '/home/other', separateHome: true, timeoutMs: 5_000, pollMs: 5, agy: AGY };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('probeAgyAccountUsage', () => {
  it('reads what agy reports for that home, sends it no prompt, stops it and leaves nothing', async () => {
    const tmux = fakeTmux(writesStatus);

    const reading = await probeAgyAccountUsage({ ...options, runTmux: tmux.runTmux, isRunning: tmux.isRunning });

    expect(reading).toMatchObject({
      email: 'someone@example.com',
      meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5 }],
    });
    expect(tmux.calls.map(({ args }) => args.find((arg) => ['new-session', 'kill-server', 'send-keys'].includes(arg))))
      .toEqual(['new-session', 'kill-server']);
    const { args, env } = tmux.calls[0]!;
    expect(env.HOME).toBe('/home/other');
    const cwd = args[args.indexOf('-c') + 1]!;
    await expect(stat(cwd)).rejects.toThrow();
    const settings = JSON.parse(args.at(-1)!.slice('--settings='.length));
    expect(settings.trustedWorkspaces).toEqual([cwd]);
    expect(settings.title.command).toContain(AGY_STATE_FILE_ENV_VAR);
  });

  it('gives up at its deadline and stops agy', async () => {
    const tmux = fakeTmux();
    await expect(probeAgyAccountUsage({
      ...options,
      timeoutMs: 30,
      runTmux: tmux.runTmux,
      isRunning: tmux.isRunning,
    })).resolves.toBeNull();
    expect(tmux.calls.at(-1)?.args).toContain('kill-server');
  });

  it('stops waiting as soon as agy quits without reporting', async () => {
    const tmux = fakeTmux((_call, quit) => {
      quit();
    });
    await expect(probeAgyAccountUsage({
      ...options,
      timeoutMs: 60_000,
      runTmux: tmux.runTmux,
      isRunning: tmux.isRunning,
    })).resolves.toBeNull();
  });

  it('still takes a report agy wrote just before it quit', async () => {
    const tmux = fakeTmux(async (call, quit) => {
      await writesStatus(call);
      quit();
    });
    await expect(probeAgyAccountUsage({
      ...options,
      timeoutMs: 60_000,
      runTmux: tmux.runTmux,
      isRunning: tmux.isRunning,
    })).resolves.toMatchObject({ email: 'someone@example.com' });
  });

  it('kills an agy that does not quit when its terminal closes', async () => {
    const tmux = fakeTmux(writesStatus);
    const killGroup = vi.fn((_pid: number) => {});
    await probeAgyAccountUsage({
      ...options,
      runTmux: tmux.runTmux,
      isRunning: () => true,
      killGroup,
      quitGraceMs: 10,
    });
    expect(killGroup).toHaveBeenCalledWith(PANE_PID);
  });

  it('still stops an agy whose start timed out in tmux', async () => {
    const runTmux = vi.fn(async (args: readonly string[]) => {
      if (args.includes('new-session')) throw new Error('timed out');
      return args.includes('list-panes') ? `${PANE_PID}\n` : '';
    });
    const killGroup = vi.fn((_pid: number) => {});
    await expect(probeAgyAccountUsage({
      ...options,
      runTmux,
      isRunning: () => true,
      killGroup,
      quitGraceMs: 10,
    })).resolves.toBeNull();
    expect(runTmux.mock.calls.some(([args]) => args.includes('kill-server'))).toBe(true);
    expect(killGroup).toHaveBeenCalledWith(PANE_PID);
  });

  it('gives a separate login nothing that could lead agy to the main login', async () => {
    for (const [name, value] of [
      ['DBUS_SESSION_BUS_ADDRESS', 'unix:path=/run/user/1000/bus'],
      ['XDG_RUNTIME_DIR', '/run/user/1000'],
      ['XDG_CONFIG_HOME', '/home/main/.config'],
      ['GEMINI_API_KEY', 'key'],
      ['GOOGLE_APPLICATION_CREDENTIALS', '/home/main/key.json'],
      ['HTTPS_PROXY', 'http://proxy.example:8080'],
    ] as const) vi.stubEnv(name, value);

    const separate = fakeTmux(writesStatus);
    await probeAgyAccountUsage({ ...options, runTmux: separate.runTmux, isRunning: separate.isRunning });
    const { env } = separate.calls[0]!;
    for (const name of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_CONFIG_HOME', 'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) {
      expect(env[name]).toBeUndefined();
    }
    expect(env.XDG_RUNTIME_DIR).not.toBe('/run/user/1000');
    expect(env.XDG_RUNTIME_DIR?.startsWith(dirname(String(env[AGY_STATE_FILE_ENV_VAR])))).toBe(true);
    expect(env.HTTPS_PROXY).toBe('http://proxy.example:8080');
    expect(env.PATH).toBe(process.env.PATH);

    const realHome = fakeTmux(writesStatus);
    await probeAgyAccountUsage({
      ...options,
      homeDir: '/home/main',
      separateHome: false,
      runTmux: realHome.runTmux,
      isRunning: realHome.isRunning,
    });
    expect(realHome.calls[0]?.env.XDG_CONFIG_HOME).toBe('/home/main/.config');
  });

  it('is no reading when tmux cannot start it, and still tries to clean up', async () => {
    const runTmux = vi.fn(async (args: readonly string[]) => {
      if (args.includes('new-session')) throw new Error('spawn tmux ENOENT');
      return '';
    });
    await expect(probeAgyAccountUsage({ ...options, runTmux })).resolves.toBeNull();
    expect(runTmux.mock.calls.at(-1)?.[0]).toContain('kill-server');
  });
});
