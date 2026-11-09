import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { killProcessTree } from '@/agent/runtime/process/killProcessTree';
import { logger } from '@/ui/logger';
import { resolveWindowsCommandInvocation } from '@piggercode/cli-common/process';

import {
  createCodexAppServerClient,
  sanitizeCodexAppServerEnv,
  type DisposableCodexAppServerClient,
} from './client/createCodexAppServerClient';
import { readCodexAppServerStartupRpcTimeoutMs } from './client/codexAppServerRpcTimeout';
import { appendCodexCliConfigOverridesArgs } from '../utils/appendCodexCliConfigOverridesArgs';
import { resolveCodexCliInvocation } from '../utils/resolveCodexCliInvocation';
import { withCodexNativeStartupLock } from '../utils/withCodexNativeStartupLock';

type InvocationResolver = (params: Readonly<{
  args: string[];
  cwd: string;
  processEnv: NodeJS.ProcessEnv;
}>) => Promise<Readonly<{ command: string; args: string[] }>>;

type SharedServerDependencies = Readonly<{
  createRuntimeDirectory: () => Promise<string>;
  resolveInvocation: InvocationResolver;
  spawnProcess: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  waitForSocket: (socketPath: string, child: ChildProcess, timeoutMs: number) => Promise<void>;
  createClient: typeof createCodexAppServerClient;
  terminateProcess: (child: ChildProcess) => Promise<void>;
  removeRuntimeDirectory: (directory: string) => Promise<void>;
  /** Removes a dead server's socket directory so a restart starts from the same state as the first start. */
  resetSocketDirectory: (directory: string) => Promise<void>;
  /** How long a stopped server may take to exit before the stop counts as unconfirmed. */
  stopExitTimeoutMs: number;
}>;

async function waitForSocket(socketPath: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let terminalError: Error | null = null;
  child.once('error', (error) => { terminalError = error; });
  child.once('exit', (code, signal) => {
    terminalError = new Error(`Codex shared app-server exited before its socket was ready (${code ?? signal ?? 'unknown'})`);
  });
  while (Date.now() - startedAt < timeoutMs) {
    if (terminalError) throw terminalError;
    try {
      await stat(socketPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for Codex shared app-server socket at ${socketPath}`);
}

function defaultDependencies(): SharedServerDependencies {
  return {
    // AF_UNIX sockets have a platform pathname limit; a caller's TMPDIR can
    // already exceed it. mkdtemp keeps the owned Unix directory private (0700).
    // Preserve the Windows temporary-directory behavior.
    createRuntimeDirectory: async () => await mkdtemp(join(
      process.platform === 'win32' ? tmpdir() : '/tmp', 'happier-codex-',
    )),
    resolveInvocation: async ({ args, cwd, processEnv }) => await resolveCodexCliInvocation({
      args,
      cwd,
      processEnv,
      overrideEnvVarKeys: ['PIGGERCODE_CODEX_APP_SERVER_BIN', 'PIGGERCODE_CODEX_TUI_BIN', 'HAPPY_CODEX_TUI_BIN'],
      targetLabel: 'Codex app-server',
    }),
    spawnProcess: spawn,
    waitForSocket,
    createClient: createCodexAppServerClient,
    terminateProcess: async (child) => { await killProcessTree(child); },
    removeRuntimeDirectory: async (directory) => await rm(directory, { recursive: true, force: true }),
    resetSocketDirectory: async (directory) => await rm(directory, { recursive: true, force: true }),
    stopExitTimeoutMs: 5_000,
  };
}

type CodexSharedAppServerParams = Readonly<{
  directory: string;
  processEnv?: NodeJS.ProcessEnv;
  configOverrides?: readonly string[];
  dependencies?: Partial<SharedServerDependencies>;
}>;

type CodexSharedAppServer = Readonly<{
  endpoint: string;
  /** Connects to the server, first starting a new one at the same endpoint if the last one died. */
  createClient: () => Promise<DisposableCodexAppServerClient>;
  /** Stops an unresponsive server. The next createClient() starts a fresh one at the same endpoint. */
  terminate: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

export async function createCodexSharedAppServer(params: CodexSharedAppServerParams): Promise<CodexSharedAppServer> {
  const processEnv = sanitizeCodexAppServerEnv(params.processEnv ?? process.env);
  // Failed initialization remains exclusive until native process shutdown,
  // too. The returned server's ongoing session activity is not locked.
  return await withCodexNativeStartupLock(readCodexAppServerStartupRpcTimeoutMs(processEnv), async () => (
    await createUnlockedCodexSharedAppServer(params)
  ));
}

async function createUnlockedCodexSharedAppServer(params: CodexSharedAppServerParams): Promise<CodexSharedAppServer> {
  const dependencies = { ...defaultDependencies(), ...params.dependencies };
  const processEnv = sanitizeCodexAppServerEnv(params.processEnv ?? process.env);
  const startupTimeoutMs = readCodexAppServerStartupRpcTimeoutMs(processEnv);
  const runtimeDirectory = await dependencies.createRuntimeDirectory();
  // Leave the socket parent absent so Codex creates it with its cross-platform
  // private-directory policy (0700 on Unix, a user-only DACL on Windows).
  const socketDirectory = join(runtimeDirectory, 'private');
  const socketPath = join(socketDirectory, 'app-server.sock');
  const endpoint = `unix://${socketPath}`;
  const transport = { kind: 'unixWebSocket', socketPath } as const;
  let child: ChildProcess | null = null;
  // Set when the current process exits or is stopped; the next createClient() starts another.
  let serverGone = false;
  const exitedChildren = new WeakSet<ChildProcess>();
  let initialClient: DisposableCodexAppServerClient | null = null;
  let disposed = false;

  const spawnServer = async (): Promise<ChildProcess> => {
    const baseInvocation = await dependencies.resolveInvocation({
      args: ['app-server', '--listen', endpoint],
      cwd: params.directory,
      processEnv,
    });
    const resolved = appendCodexCliConfigOverridesArgs(baseInvocation, params.configOverrides ?? []);
    const invocation = resolveWindowsCommandInvocation({
      command: resolved.command,
      args: resolved.args,
      env: processEnv,
      resolveCommandOnPath: true,
    });
    const spawned = dependencies.spawnProcess(invocation.command, invocation.args, {
      cwd: params.directory,
      env: processEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    child = spawned;
    serverGone = false;
    spawned.once('exit', () => {
      exitedChildren.add(spawned);
      if (child === spawned) serverGone = true;
    });
    spawned.stderr?.on('data', (chunk) => {
      logger.debug('[codex-shared-app-server] stderr', String(chunk).trim());
    });
    return spawned;
  };

  try {
    const spawned = await spawnServer();
    await dependencies.waitForSocket(socketPath, spawned, startupTimeoutMs);
    // Socket publication is not native initialization readiness. Complete the
    // actual handshake before another native process can touch shared state.
    initialClient = await dependencies.createClient({
      cwd: params.directory,
      processEnv,
      transport,
    });
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      if (child) await dependencies.terminateProcess(child);
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    try {
      await dependencies.removeRuntimeDirectory(runtimeDirectory);
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length > 1) throw new AggregateError(failures, 'Codex shared app-server startup and cleanup failed');
    throw error;
  }

  const waitForExit = async (proc: ChildProcess, timeoutMs: number): Promise<boolean> => {
    if (exitedChildren.has(proc) || proc.exitCode != null || proc.signalCode != null) return true;
    return await new Promise<boolean>((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        proc.removeListener('exit', onExit);
        resolve(exitedChildren.has(proc));
      }, timeoutMs);
      proc.once('exit', onExit);
    });
  };

  // With requireExit, throws unless the process is known to have exited.
  const stopCurrentServer = async (options: Readonly<{ requireExit: boolean }>): Promise<void> => {
    const unusedInitialClient = initialClient;
    initialClient = null;
    try {
      await unusedInitialClient?.dispose();
    } catch {
      // The process is about to be stopped; a failed client close changes nothing.
    }
    const current = child;
    serverGone = true;
    if (!current) return;
    try {
      await dependencies.terminateProcess(current);
    } catch (error) {
      // A replacement can still start: its socket directory is recreated from scratch.
      logger.warn('[codex-shared-app-server] Could not confirm the old Codex app-server stopped', error);
    }
    if (options.requireExit && !(await waitForExit(current, dependencies.stopExitTimeoutMs))) {
      throw new Error('Codex shared app-server did not exit after it was stopped');
    }
  };

  // A replacement server starts exactly like the first one: same endpoint, so attached
  // terminals and the published endpoint stay valid, and the same native startup lock.
  const restartAndConnect = async (): Promise<DisposableCodexAppServerClient> => (
    await withCodexNativeStartupLock(startupTimeoutMs, async () => {
      const assertNotDisposed = (): void => {
        if (disposed) throw new Error('Codex shared app-server has been disposed');
      };
      assertNotDisposed();
      // Never start a second server beside one that may still be alive and holding work.
      await stopCurrentServer({ requireExit: true });
      await dependencies.resetSocketDirectory(socketDirectory);
      assertNotDisposed();
      const spawned = await spawnServer();
      try {
        assertNotDisposed();
        await dependencies.waitForSocket(socketPath, spawned, startupTimeoutMs);
        assertNotDisposed();
        const client = await dependencies.createClient({
          cwd: params.directory,
          processEnv,
          transport,
        });
        if (disposed) {
          await client.dispose().catch(() => undefined);
          assertNotDisposed();
        }
        return client;
      } catch (error) {
        serverGone = true;
        await dependencies.terminateProcess(spawned).catch(() => undefined);
        throw error;
      }
    })
  );

  const connect = async (): Promise<DisposableCodexAppServerClient> => {
    if (disposed) throw new Error('Codex shared app-server has been disposed');
    if (initialClient && !serverGone) {
      const client = initialClient;
      initialClient = null;
      return client;
    }
    if (serverGone) {
      logger.warn('[codex-shared-app-server] Codex app-server is gone; starting a new one at the same endpoint');
      return await restartAndConnect();
    }
    return await dependencies.createClient({
      cwd: params.directory,
      processEnv,
      transport,
    });
  };

  // One connection attempt at a time, so two callers never start two replacement servers.
  let connectQueue: Promise<unknown> = Promise.resolve();
  return {
    endpoint,
    createClient: async () => {
      const attempt = connectQueue.then(connect, connect);
      connectQueue = attempt.catch(() => undefined);
      return await attempt;
    },
    terminate: async () => {
      if (disposed) return;
      await stopCurrentServer({ requireExit: true });
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await initialClient?.dispose();
      initialClient = null;
      if (child) await dependencies.terminateProcess(child);
      await dependencies.removeRuntimeDirectory(runtimeDirectory);
    },
  };
}
