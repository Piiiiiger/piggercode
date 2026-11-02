import { describe, expect, it, vi } from 'vitest';
import { spawnSync as spawnLocalCommand } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { runCommandCapture } from '../process/index.js';
import { installProviderCli, resolvePlatformFromNodePlatform } from './install.js';

type SpawnSyncShapedMock = (
  command: string,
  args?: ReadonlyArray<string>,
  options?: import('node:child_process').SpawnSyncOptions,
) => import('node:child_process').SpawnSyncReturns<Buffer | string>;

/**
 * Long-running install commands run through the async process owner (`runCommand`);
 * these tests describe the child process with one spawnSync-shaped fake, so adapt it.
 */
function runCommandFrom(mock: SpawnSyncShapedMock): typeof runCommandCapture {
  return async ({ cmd, args, cwd, env }) => {
    const result = mock(cmd, args, { cwd, env });
    if (result.error) return { kind: 'spawn-failed', message: result.error.message, error: result.error };
    return {
      kind: 'exited',
      status: result.status,
      signal: result.signal,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  };
}

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const originalArchDescriptor = Object.getOwnPropertyDescriptor(process, 'arch');

describe('installProviderCli vendor_recipe execution gating', () => {
  it.skipIf(process.platform === 'win32')('preserves a Windows Path-only environment when executing a vendor recipe', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-vendor-windows-path-'));
    if (!originalPlatformDescriptor) throw new Error('Expected configurable platform');
    const previousPath = process.env.PATH;
    try {
      // A real harmless executable stands in for the vendor's OS process. The
      // install owner, PATH resolution and child-process capture remain real.
      const executable = join(homeDir, 'powershell.exe');
      await writeFile(executable, '#!/bin/sh\nprintf vendor-process-started\n', 'utf8');
      await chmod(executable, 0o755);
      delete process.env.PATH;
      Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'win32' });
      const result = await installProviderCli({
        providerId: 'claude', platform: 'win32',
        env: { Path: homeDir, PIGGERCODE_HOME_DIR: homeDir },
        logDir: homeDir, skipIfInstalled: false, allowVendorRecipeExecution: true,
      });
      expect(result.ok, result.ok ? undefined : result.errorMessage).toBe(true);
      if (result.logPath) expect(await readFile(result.logPath, 'utf8')).toContain('vendor-process-started');
    } finally {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('denies vendor_recipe execution by default (but still returns the plan)', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'happier-cli-common-install-gating-log-'));
    try {
      const platform = resolvePlatformFromNodePlatform(process.platform);
      expect(platform).not.toBeNull();
      if (!platform) return;

      const res = await installProviderCli({
        providerId: 'claude',
        platform,
        logDir,
        // Avoid accidentally running real commands in the pre-gating implementation.
        env: { ...process.env, PATH: '' },
        skipIfInstalled: false,
      });

      expect(res.ok).toBe(false);
      if (res.ok) return;

      expect(res.errorCode).toBe('vendor-recipe-disallowed');
      expect(res.plan?.installMode).toBe('vendor_recipe');
      expect(res.logPath).toBeNull();
      expect(res.errorMessage).toContain('allowVendorRecipeExecution');
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  });

  it('surfaces a targeted memory-pressure hint when a vendor recipe is killed with exit 137', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happier-cli-common-install-vendor-oom-home-'));
    const logDir = await mkdtemp(join(tmpdir(), 'happier-cli-common-install-vendor-oom-log-'));
    const binDir = await mkdtemp(join(tmpdir(), 'happier-cli-common-install-vendor-oom-bin-'));
    try {
      const platform = resolvePlatformFromNodePlatform(process.platform);
      expect(platform).not.toBeNull();
      if (!platform) return;

      type SpawnSyncFn = typeof import('node:child_process').spawnSync;
      type SpawnSyncMockFn = (
        command: string,
        args?: ReadonlyArray<string>,
        options?: import('node:child_process').SpawnSyncOptions,
      ) => import('node:child_process').SpawnSyncReturns<Buffer>;
      const spawnSyncMock = vi
        .fn<SpawnSyncMockFn>(() => ({
          pid: 0,
          output: [null, Buffer.alloc(0), Buffer.from('installer died')],
          status: 137,
          signal: 'SIGKILL',
          stdout: Buffer.alloc(0),
          stderr: Buffer.from('installer died'),
        }))
        .mockName('spawnSync');

      const bashPath = join(binDir, process.platform === 'win32' ? 'bash.cmd' : 'bash');
      await writeFile(bashPath, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', 'utf8');
      if (process.platform !== 'win32') {
        await chmod(bashPath, 0o755);
      }

      const res = await installProviderCli({
        providerId: 'claude',
        platform,
        logDir,
        env: {
          ...process.env,
          PIGGERCODE_HOME_DIR: homeDir,
          HOME: homeDir,
          PATH: `${binDir}:/bin`,
        },
        skipIfInstalled: false,
        allowVendorRecipeExecution: true,
        deps: {
          spawnSync: spawnSyncMock as unknown as SpawnSyncFn,
          runCommand: runCommandFrom(spawnSyncMock),
        },
      });

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.errorCode).toBe('command-failed');
      expect(res.errorMessage).toContain('ran out of memory');
      expect(res.errorMessage).toContain('increase available memory or swap');
      expect(res.logPath).not.toBeNull();
    } finally {
      await rm(homeDir, { recursive: true, force: true });
      await rm(logDir, { recursive: true, force: true });
      await rm(binDir, { recursive: true, force: true });
    }
  });
});
