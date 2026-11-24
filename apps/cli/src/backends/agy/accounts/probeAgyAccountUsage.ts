import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  AGY_STATE_FILE_ENV_VAR,
  AGY_STATE_TITLE_SETTING,
  agyLaunchEnv,
} from '@/backends/agy/nativeTerminal/agyNativeTerminal';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import { logger } from '@/ui/logger';

import { readAgyAccountUsageFromStatus, type AgyAccountUsageReading } from './readAgyAccountUsageFromStatus';

const execFileAsync = promisify(execFile);

const STATE_POLL_MS = 200;
const TMUX_COMMAND_TIMEOUT_MS = 5_000;
/** How long agy gets to quit after its terminal closes before it is killed. */
const QUIT_GRACE_MS = 2_000;

/**
 * All a separate login's agy takes from the daemon's environment. Anything else could lead it to the main
 * login: a keyring's address, another config folder, an API key.
 */
const SEPARATE_LOGIN_ENV = [
  'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];

export type RunTmux = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string>;

export const runTmuxCommand: RunTmux = async (args, env) => {
  const { stdout } = await execFileAsync('tmux', [...args], { env, timeout: TMUX_COMMAND_TIMEOUT_MS });
  return stdout;
};

function signalReaches(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch {
    return false;
  }
}

/** The pane's program, or anything it started: they share its process group. */
export const isProcessRunning = (pid: number): boolean => signalReaches(pid) || signalReaches(-pid);

export function parsePanePid(printed: string): number | null {
  const pid = Number.parseInt(printed.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function killProcessGroup(pid: number): void {
  try {
    // The pane's program leads its own process group, with whatever it started.
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/** agy's environment on a login: a separate login gets only the allowlist, its own home and an empty runtime folder. */
export function probeEnv(statePath: string, homeDir: string, separateRuntimeDir: string | null): NodeJS.ProcessEnv {
  const launch = agyLaunchEnv(statePath);
  const env: NodeJS.ProcessEnv = separateRuntimeDir
    ? Object.fromEntries(SEPARATE_LOGIN_ENV.flatMap((name) => (launch[name] === undefined ? [] : [[name, launch[name]]])))
    : { ...launch };
  delete env.TMUX;
  delete env.TMUX_PANE;
  // An empty folder, so a client that looks for the desktop's bus in the default place finds none.
  if (separateRuntimeDir) env.XDG_RUNTIME_DIR = separateRuntimeDir;
  env.HOME = homeDir;
  env.TERM = 'xterm-256color';
  env[AGY_STATE_FILE_ENV_VAR] = statePath;
  return env;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads a login's limits the only way agy offers them: starts the official agy on that login's home, in a
 * private empty folder and with no prompt, until its status command reports them, then stops it. It runs in
 * its own tmux server, as agy sessions run in tmux, so its environment is exactly this one. The login stays
 * in agy's own files and nothing here opens them. The folder's trust is for this launch only (`--settings`
 * is not saved).
 */
export async function probeAgyAccountUsage(params: Readonly<{
  homeDir: string;
  /** A login other than the real home's: everything agy finds must come from `homeDir`. */
  separateHome: boolean;
  timeoutMs: number;
  agy?: Readonly<{ command: string; args: readonly string[] }>;
  runTmux?: RunTmux;
  isRunning?: (pid: number) => boolean;
  killGroup?: (pid: number) => void;
  pollMs?: number;
  quitGraceMs?: number;
}>): Promise<AgyAccountUsageReading | null> {
  const runTmux = params.runTmux ?? runTmuxCommand;
  const isRunning = params.isRunning ?? isProcessRunning;
  const dir = await mkdtemp(join(tmpdir(), 'pc-agy-'));
  const socket = join(dir, 't');
  let env: NodeJS.ProcessEnv | null = null;
  let pid: number | null = null;
  try {
    const cwd = join(dir, 'cwd');
    await mkdir(cwd);
    const statePath = join(dir, 'state.json');
    const agy = params.agy ?? requireProviderCliLaunchSpec('agy', { processEnv: process.env });
    const separateRuntimeDir = params.separateHome ? join(dir, 'run') : null;
    if (separateRuntimeDir) await mkdir(separateRuntimeDir, { mode: 0o700 });
    env = probeEnv(statePath, params.homeDir, separateRuntimeDir);
    const deadline = Date.now() + params.timeoutMs;
    const printed = await runTmux([
      '-S', socket, '-f', '/dev/null', 'new-session', '-d', '-P', '-F', '#{pane_pid}', '-x', '120', '-y', '30', '-c', cwd,
      agy.command, ...agy.args,
      `--settings=${JSON.stringify({ trustedWorkspaces: [cwd], title: AGY_STATE_TITLE_SETTING })}`,
    ], env);
    pid = parsePanePid(printed);

    for (;;) {
      const quitBeforeThisRead = pid !== null && !isRunning(pid);
      const reading = await readFile(statePath, 'utf8')
        .then((raw) => readAgyAccountUsageFromStatus(JSON.parse(raw)))
        .catch(() => null);
      if (reading) return reading;
      if (quitBeforeThisRead || Date.now() >= deadline) break;
      await pause(params.pollMs ?? STATE_POLL_MS);
    }
    logger.infoFile('[agy-accounts] agy reported no limits for this login');
    return null;
  } catch (error) {
    logger.infoFile('[agy-accounts] Could not start agy to read a login', error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    if (env) {
      // A `new-session` that timed out may still have started agy.
      pid ??= parsePanePid(await runTmux(['-S', socket, 'list-panes', '-a', '-F', '#{pane_pid}'], env).catch(() => ''));
      await runTmux(['-S', socket, 'kill-server'], env).catch(() => undefined);
      if (pid !== null) {
        const giveUpAt = Date.now() + (params.quitGraceMs ?? QUIT_GRACE_MS);
        while (isRunning(pid) && Date.now() < giveUpAt) await pause(50);
        if (isRunning(pid)) (params.killGroup ?? killProcessGroup)(pid);
      }
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
