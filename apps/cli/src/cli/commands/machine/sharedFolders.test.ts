import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { readSettings } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';

import { runSharedFoldersSubcommand } from './sharedFolders';

const envScope = createEnvKeyScope(['HOME', 'SSH_ORIGINAL_COMMAND']);
const directories: string[] = [];

afterEach(() => {
  envScope.restore();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('piggercode machine shared-folders', () => {
  it('keeps the SSH address a server is reached at, and refuses one that is not an address', async () => {
    await withConfiguredDaemonTestHome({ prefix: 'piggercode-shared-folders-cli-' }, async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await runSharedFoldersSubcommand(['address', 'server.example.test:2200'], false);
      expect((await readSettings()).sharedFoldersSshAddress).toBe('server.example.test:2200');

      await expect(runSharedFoldersSubcommand(['address', 'pigger@server'], false)).rejects.toThrow(/Not an SSH address/);
      expect((await readSettings()).sharedFoldersSshAddress).toBe('server.example.test:2200');

      await runSharedFoldersSubcommand(['address', '--clear'], false);
      expect((await readSettings()).sharedFoldersSshAddress).toBeUndefined();
    });
  });

  it('serve writes nothing to stdout, the connection, even when it refuses', async () => {
    const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-serve-cli-'));
    directories.push(home);
    process.env.HOME = home;
    process.env.SSH_ORIGINAL_COMMAND = 'cat ~/.ssh/id_ed25519';
    const stdout = vi.spyOn(process.stdout, 'write');
    const log = vi.spyOn(console, 'log');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runSharedFoldersSubcommand(['serve', '--label', 'laptop'], false);

    expect(process.exitCode).toBe(2);
    expect(stdout).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('can only mount a folder'));
  });
});
