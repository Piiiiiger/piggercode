import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createCodexSharedAppServer } from './createCodexSharedAppServer';
import { buildCodexAppServerConfigOverrides } from './buildCodexAppServerConfigOverrides';
import { createCodexAppServerProcessEnv } from './testkit/fakeCodexAppServer';
import { killProcessTree } from '@/agent/runtime/process/killProcessTree';

// Genuine OS enumeration failure; native spawn, socket startup, and cleanup remain real.
const enumeration = vi.hoisted(() => ({ denied: false }));
vi.mock('ps-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ps-list')>();
  return { default: () => enumeration.denied
    ? Promise.reject(new Error('process listing unavailable')) : actual.default() };
});

describe('createCodexSharedAppServer', () => {
  it.skipIf(process.platform === 'win32').each([
    ['serializes native startup through the first real initialize handshake for a shared home', false, false, false],
    ['initializes the default socket server despite an overlong caller TMPDIR', true, false, false],
    ['keeps failed native startup exclusive through process shutdown', false, true, false],
    ['preserves live native initialization failure alongside failed process cleanup', false, true, true],
  ] as const)('%s', async (_name, longCallerTemp, firstInitializeFails, cleanupListingDenied) => {
    const directory = await mkdtemp(join(tmpdir(), 'happier-codex-shared-native-startup-'));
    if (longCallerTemp) {
      const callerTemp = join(directory, 'caller-temporary-directory-with-a-long-native-unix-socket-prefix');
      await mkdir(callerTemp);
      vi.stubEnv('TMPDIR', callerTemp);
    }
    const executable = join(directory, 'fake-shared-server.mjs');
    await writeFile(executable, [
      'import { mkdir, rm } from "node:fs/promises";',
      'import { join, dirname } from "node:path";',
      'import { createServer } from "node:http";',
      `import WebSocket from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('ws-node')).href)};`,
      'const WebSocketServer = WebSocket.WebSocketServer;',
      'await mkdir(process.env.CODEX_HOME, { recursive: true });',
      'const guard = join(process.env.CODEX_HOME, "native-startup");',
      'await mkdir(guard);',
      'process.on("SIGTERM", async () => { await new Promise(resolve => setTimeout(resolve, 100)); await rm(guard, { recursive: true, force: true }); process.exit(0); });',
      'const socketPath = process.argv.find(arg => arg.startsWith("unix://")).slice(7);',
      'await mkdir(dirname(socketPath), { recursive: true });',
      'const server = createServer();',
      'const sockets = new WebSocketServer({ server });',
      'sockets.on("connection", socket => socket.on("message", async data => {',
      '  const message = JSON.parse(data.toString());',
      '  if (message.method === "initialize") {',
      '    await new Promise(resolve => setTimeout(resolve, 100));',
      '    if (process.env.FIXTURE_INITIALIZE_FAILS === "true") { socket.send(JSON.stringify({ id: message.id, error: { code: -32000, message: "fixture initialize failed" } })); return; }',
      '    await rm(guard, { recursive: true, force: true });',
      '    socket.send(JSON.stringify({ id: message.id, result: {} }));',
      '  } else if (message.method === "test/ping") {',
      '    socket.send(JSON.stringify({ id: message.id, result: { pong: true } }));',
      '  }',
      '}));',
      'server.listen(socketPath);',
    ].join('\n'));
    const servers: Awaited<ReturnType<typeof createCodexSharedAppServer>>[] = [];
    const clients: Awaited<ReturnType<Awaited<ReturnType<typeof createCodexSharedAppServer>>['createClient']>>[] = [];
    const stderr: string[] = [];
    const nativeStartupLock = join(userInfo().homedir, '.piggercode-codex-native-startup.lock');
    let failedStartupOwner: string | null = null;
    const cleanupWasExclusive: boolean[] = [];
    const spawnProcess = vi.fn(spawn);
    spawnProcess.mockImplementation((...args) => {
      if (args[2]?.env?.FIXTURE_INITIALIZE_FAILS === 'true') failedStartupOwner = readFileSync(nativeStartupLock, 'utf8');
      const child = spawn(...args);
      child.stderr?.on('data', chunk => { stderr.push(String(chunk)); });
      return child;
    });
    try {
      const outcomes = await Promise.allSettled(['a', 'b'].map(async suffix => {
        const server = await createCodexSharedAppServer({
          directory,
          processEnv: createCodexAppServerProcessEnv(executable, {
            CODEX_HOME: join(directory, 'shared-home'), CODEX_SQLITE_HOME: join(directory, `sqlite-${suffix}`),
            FIXTURE_INITIALIZE_FAILS: String(firstInitializeFails && suffix === 'a'),
          }),
          dependencies: {
            spawnProcess,
            ...(firstInitializeFails ? { terminateProcess: async child => {
              let observedOwner: string | null = null;
              try { observedOwner = readFileSync(nativeStartupLock, 'utf8'); } catch { /* An absent owner means unlocked cleanup. */ }
              cleanupWasExclusive.push(observedOwner !== null && observedOwner === failedStartupOwner);
              const previousDenial = enumeration.denied;
              enumeration.denied = cleanupListingDenied && suffix === 'a';
              try { await killProcessTree(child); } finally { enumeration.denied = previousDenial; }
            } } : {}),
            // The test's routed TMPDIR may exceed the native Unix socket limit.
            ...(longCallerTemp ? {} : {
              createRuntimeDirectory: async () => await mkdtemp(join('/tmp', 'c-')),
            }),
          },
        });
        servers.push(server);
        const client = await server.createClient();
        clients.push(client);
        return client.request('test/ping');
      }));
      expect({ outcomes, stderr }).toEqual({ outcomes: [
        firstInitializeFails ? { status: 'rejected', reason: cleanupListingDenied
          ? expect.objectContaining({ name: 'AggregateError', errors: [
            expect.objectContaining({ message: 'fixture initialize failed' }),
            expect.objectContaining({ code: 'process_tree_termination_incomplete' }),
          ] }) : expect.objectContaining({ message: 'fixture initialize failed' }) }
          : { status: 'fulfilled', value: { pong: true } },
        { status: 'fulfilled', value: { pong: true } },
      ], stderr: [] });
      if (firstInitializeFails) expect(cleanupWasExclusive[0]).toBe(true);
    } finally {
      if (longCallerTemp) vi.unstubAllEnvs();
      await Promise.all(clients.map(client => client.dispose()));
      await Promise.all(servers.map(server => server.dispose()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves native startup failure when the process already exited despite unavailable enumeration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happier-codex-startup-failure-'));
    enumeration.denied = true;
    try {
      // An actual executable rejects the agent argv before opening a socket. No fake prompt
      // or AppServer logic: this is the native process failure boundary.
      const failure = await createCodexSharedAppServer({
        directory,
        processEnv: { ...process.env, PIGGERCODE_CODEX_APP_SERVER_BIN: process.execPath },
        dependencies: { createRuntimeDirectory: () => mkdtemp(join(directory, 'runtime-')) },
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ message: expect.stringContaining('exited before its socket was ready') });
      expect(failure).not.toBeInstanceOf(AggregateError);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      enumeration.denied = false;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('owns one socket app-server and gives PiggerCode clients WebSocket transports to that server', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 42, stderr: new EventEmitter() });
    const spawnProcess = vi.fn(() => child as never);
    const createClient = vi.fn(async (params: unknown) => ({ params, dispose: vi.fn() }));
    const terminateProcess = vi.fn(async () => undefined);
    const removeRuntimeDirectory = vi.fn(async () => undefined);
    const waitForSocket = vi.fn(async () => undefined);

    const server = await createCodexSharedAppServer({
      directory: '/workspace',
      processEnv: {
        HOME: '/home/test',
        PIGGERCODE_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '90000',
      },
      configOverrides: buildCodexAppServerConfigOverrides({}, {
        codexArgs: ['-c', 'model="gpt-5"', '--config=model_reasoning_effort=low'],
      }),
      dependencies: {
        createRuntimeDirectory: async () => '/tmp/happier-codex-private',
        resolveInvocation: async ({ args }) => ({ command: '/usr/bin/codex', args }),
        spawnProcess,
        waitForSocket,
        createClient: createClient as never,
        terminateProcess,
        removeRuntimeDirectory,
      },
    });

    expect(server.endpoint).toBe('unix:///tmp/happier-codex-private/private/app-server.sock');
    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/bin/codex',
      [
        'app-server', '--listen', 'unix:///tmp/happier-codex-private/private/app-server.sock',
        '-c', 'model="gpt-5"',
        '-c', 'model_reasoning_effort=low',
      ],
      expect.objectContaining({ cwd: '/workspace', stdio: ['ignore', 'ignore', 'pipe'] }),
    );
    expect(waitForSocket).toHaveBeenCalledWith(
      '/tmp/happier-codex-private/private/app-server.sock',
      child,
      90_000,
    );

    await server.createClient();
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace',
      transport: { kind: 'unixWebSocket', socketPath: '/tmp/happier-codex-private/private/app-server.sock' },
    }));

    await server.dispose();
    expect(terminateProcess).toHaveBeenCalledWith(child);
    expect(removeRuntimeDirectory).toHaveBeenCalledWith('/tmp/happier-codex-private');
  });

  it.skipIf(process.platform === 'win32')('replaces a stopped native server with a new process at the same socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'happier-codex-shared-respawn-'));
    const executable = join(directory, 'fake-shared-server.mjs');
    await writeFile(executable, [
      'import { mkdir } from "node:fs/promises";',
      'import { dirname } from "node:path";',
      'import { createServer } from "node:http";',
      `import WebSocket from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('ws-node')).href)};`,
      'const socketPath = process.argv.find(arg => arg.startsWith("unix://")).slice(7);',
      'await mkdir(dirname(socketPath), { recursive: true });',
      'const server = createServer();',
      'const sockets = new WebSocket.WebSocketServer({ server });',
      'sockets.on("connection", socket => socket.on("message", data => {',
      '  const message = JSON.parse(data.toString());',
      '  if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));',
      '  else if (message.method === "test/pid") socket.send(JSON.stringify({ id: message.id, result: { pid: process.pid } }));',
      '}));',
      'server.listen(socketPath);',
    ].join('\n'));
    const server = await createCodexSharedAppServer({
      directory,
      processEnv: createCodexAppServerProcessEnv(executable, { CODEX_HOME: join(directory, 'home') }),
      dependencies: { createRuntimeDirectory: async () => await mkdtemp(join('/tmp', 'c-')) },
    });
    const clients: Awaited<ReturnType<typeof server.createClient>>[] = [];
    try {
      const first = await server.createClient();
      clients.push(first);
      const firstPid = (await first.request('test/pid') as { pid: number }).pid;

      await server.terminate();
      const second = await server.createClient();
      clients.push(second);
      const secondPid = (await second.request('test/pid') as { pid: number }).pid;

      expect(secondPid).not.toBe(firstPid);
      expect(() => process.kill(firstPid, 0)).toThrow();
    } finally {
      await Promise.all(clients.map((client) => client.dispose().catch(() => undefined)));
      await server.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('starts a replacement server at the same endpoint after the server exits or is stopped', async () => {
    const children = [41, 42, 43].map((pid) => Object.assign(new EventEmitter(), { pid, stderr: new EventEmitter() }));
    let spawnCount = 0;
    const spawnProcess = vi.fn(() => children[spawnCount++] as never);
    const createClient = vi.fn(async (params: unknown) => ({ params, dispose: vi.fn(async () => undefined) }));
    const terminateProcess = vi.fn(async (child: EventEmitter) => { child.emit('exit', null, 'SIGTERM'); });
    const resetSocketDirectory = vi.fn(async () => undefined);
    const server = await createCodexSharedAppServer({
      directory: '/workspace',
      processEnv: { HOME: '/home/test' },
      dependencies: {
        createRuntimeDirectory: async () => '/tmp/happier-codex-private',
        resolveInvocation: async ({ args }) => ({ command: '/usr/bin/codex', args }),
        spawnProcess,
        waitForSocket: vi.fn(async () => undefined),
        createClient: createClient as never,
        terminateProcess,
        removeRuntimeDirectory: vi.fn(async () => undefined),
        resetSocketDirectory,
      },
    });
    const listenArgs = ['app-server', '--listen', 'unix:///tmp/happier-codex-private/private/app-server.sock'];

    await server.createClient();
    await server.createClient();
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    children[0]!.emit('exit', 1, null);
    await server.createClient();
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenLastCalledWith('/usr/bin/codex', listenArgs, expect.anything());
    expect(resetSocketDirectory).toHaveBeenCalledWith('/tmp/happier-codex-private/private');

    await server.terminate();
    expect(terminateProcess).toHaveBeenLastCalledWith(children[1]);
    await server.createClient();
    expect(spawnProcess).toHaveBeenCalledTimes(3);
    expect(spawnProcess).toHaveBeenLastCalledWith('/usr/bin/codex', listenArgs, expect.anything());
    expect(server.endpoint).toBe('unix:///tmp/happier-codex-private/private/app-server.sock');

    await server.dispose();
    expect(terminateProcess).toHaveBeenLastCalledWith(children[2]);
  });

  function createFakeSharedServerDependencies() {
    const children = [51, 52, 53].map((pid) => Object.assign(new EventEmitter(), { pid, stderr: new EventEmitter() }));
    let spawnCount = 0;
    return {
      children,
      dependencies: {
        createRuntimeDirectory: async () => '/tmp/happier-codex-private',
        resolveInvocation: async ({ args }: { args: string[] }) => ({ command: '/usr/bin/codex', args }),
        spawnProcess: vi.fn(() => children[spawnCount++] as never),
        waitForSocket: vi.fn(async () => undefined),
        createClient: vi.fn(async (params: unknown) => ({ params, dispose: vi.fn(async () => undefined) })) as never,
        terminateProcess: vi.fn(async () => undefined),
        removeRuntimeDirectory: vi.fn(async () => undefined),
        resetSocketDirectory: vi.fn(async () => undefined),
        stopExitTimeoutMs: 30,
      },
    };
  }

  it('reports a stop it cannot confirm, so the caller does not treat the server as gone', async () => {
    const { dependencies } = createFakeSharedServerDependencies();
    const server = await createCodexSharedAppServer({ directory: '/workspace', processEnv: { HOME: '/home/test' }, dependencies });
    try {
      await expect(server.terminate()).rejects.toThrow(/did not exit/);
    } finally {
      await server.dispose();
    }
  });

  it('does not start a replacement once the server is disposed during the restart', async () => {
    const { children, dependencies } = createFakeSharedServerDependencies();
    let releaseReset!: () => void;
    dependencies.resetSocketDirectory = vi.fn(() => new Promise<void>((resolve) => { releaseReset = resolve; }));
    const server = await createCodexSharedAppServer({ directory: '/workspace', processEnv: { HOME: '/home/test' }, dependencies });
    await server.createClient();

    children[0]!.emit('exit', 1, null);
    const reconnect = server.createClient();
    await vi.waitFor(() => expect(dependencies.resetSocketDirectory).toHaveBeenCalled());
    await server.dispose();
    releaseReset();

    await expect(reconnect).rejects.toThrow(/disposed/);
    expect(dependencies.spawnProcess).toHaveBeenCalledTimes(1);
  });

  it('does not start a replacement beside a server whose exit was never confirmed', async () => {
    const { dependencies } = createFakeSharedServerDependencies();
    const server = await createCodexSharedAppServer({ directory: '/workspace', processEnv: { HOME: '/home/test' }, dependencies });
    try {
      await expect(server.terminate()).rejects.toThrow(/did not exit/);
      await expect(server.createClient()).rejects.toThrow(/did not exit/);
      expect(dependencies.spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      await server.dispose();
    }
  });
});
