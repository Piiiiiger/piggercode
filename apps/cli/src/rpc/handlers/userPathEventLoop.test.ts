import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

// A user path may sit inside a network mount that hangs for minutes. A synchronous filesystem call on
// it freezes the whole daemon (every terminal stream, the relay connection), so daemon RPC handlers
// must reach user paths only through asynchronous calls, which wait on the thread pool instead.
// node:fs is the system boundary here: the real functions run, and the spies only record who called.
const syncCalls = vi.hoisted(() => [] as string[]);

vi.mock('node:fs', async (importOriginal) => withSyncCallRecording(await importOriginal<typeof import('node:fs')>()));
vi.mock('fs', async (importOriginal) => withSyncCallRecording(await importOriginal<typeof import('fs')>()));

function withSyncCallRecording<T extends Record<string, unknown>>(actual: T): T {
  const names = ['realpathSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'copyFileSync', 'accessSync', 'rmSync'];
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of names) {
    const original = actual[name] as ((...args: unknown[]) => unknown) & { native?: (...args: unknown[]) => unknown };
    const spy = (...args: unknown[]) => {
      syncCalls.push(`${name}(${String(args[0])})`);
      return original(...args);
    };
    if (name === 'realpathSync') {
      (spy as typeof original).native = (...args: unknown[]) => {
        syncCalls.push(`realpathSync.native(${String(args[0])})`);
        return original.native!(...args);
      };
    }
    wrapped[name] = spy;
  }
  return { ...wrapped, default: wrapped } as unknown as T;
}

import { authorizeFilesystemPath } from './fileSystem/accessPolicy/filesystemPathAuthorization';
import { registerFileSystemHandlers } from './fileSystem';
import { validateMachineBrowsePath } from './machineFileBrowser/machineBrowsePathPolicy';
import { validatePath } from './pathSecurity';
import { normalizePathspec, resolveCwd } from '@/scm/runtime';

type Handler = (data: unknown) => Promise<{ success?: boolean; error?: string }>;

describe('daemon RPC handlers and user paths', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'happier-user-path-loop-')));
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src', 'a.txt'), 'a');
    syncCalls.length = 0;
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const userPathCalls = () => syncCalls.filter((call) => call.includes(workspace));

  it('authorizes a path under restricted roots without a synchronous filesystem call', async () => {
    const result = await authorizeFilesystemPath({
      targetPath: 'src/missing/new.txt',
      defaultDirectory: workspace,
      accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
    });
    expect(result).toEqual({ valid: true, resolvedPath: join(workspace, 'src', 'missing', 'new.txt') });
    expect(userPathCalls()).toEqual([]);
  });

  it('validates a workspace path without a synchronous filesystem call', async () => {
    const result = await validatePath('src/a.txt', workspace);
    expect(result).toMatchObject({ valid: true });
    expect(userPathCalls()).toEqual([]);
  });

  it('validates a machine browse path without a synchronous filesystem call', async () => {
    const result = await validateMachineBrowsePath({
      targetPath: join(workspace, 'src'),
      roots: [{ id: workspace, label: workspace, path: workspace }],
    });
    expect(result).toEqual({ valid: true, resolvedPath: join(workspace, 'src') });
    expect(userPathCalls()).toEqual([]);
  });

  it('resolves an SCM cwd and pathspec without a synchronous filesystem call', async () => {
    const cwd = await resolveCwd('src', workspace, { kind: 'restrictedRoots', roots: [workspace] });
    expect(cwd).toEqual({ ok: true, cwd: join(workspace, 'src') });
    expect(await normalizePathspec('a.txt', join(workspace, 'src'))).toEqual({ ok: true, pathspec: 'a.txt' });
    expect(userPathCalls()).toEqual([]);
  });

  it('deletes and renames under restricted roots without a synchronous filesystem call', async () => {
    const handlers = new Map<string, Handler>();
    registerFileSystemHandlers(
      { registerHandler: (method: string, handler: Handler) => void handlers.set(method, handler) } as unknown as RpcHandlerManager,
      workspace,
      {
        accessPolicy: { kind: 'restrictedRoots', roots: [workspace] },
        // The home is not a user path: it is local, and only read to tell the shared folders under it.
        sharedFolders: { homeDir: '/nonexistent-home', readMountinfo: () => '' },
      },
    );
    const rename = handlers.get(RPC_METHODS.RENAME_PATH)!;
    const remove = handlers.get(RPC_METHODS.DELETE_PATH)!;
    expect(await rename({ from: 'src/a.txt', to: 'src/b.txt' })).toEqual({ success: true });
    expect(await remove({ path: 'src/b.txt' })).toEqual({ success: true });
    expect(userPathCalls()).toEqual([]);
  });
});
