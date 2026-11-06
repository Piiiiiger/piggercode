import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { configuration } from '@/configuration';
import { writeExecutableShimSync } from '@/testkit/fs/executableShim';

import { listAcceptedComputers } from './acceptedComputers';
import { buildSharedFoldersServeCommand } from './serveCommand';

/** The managed install's `current` binary, as an update leaves it (stable ring). */
const currentBinary = () => join(configuration.happyHomeDir, 'cli', 'current', 'piggercode');

describe('the forced command a computer\'s key runs on this server', () => {
  afterEach(() => {
    rmSync(join(configuration.happyHomeDir, 'cli', 'current'), { recursive: true, force: true });
  });

  it('names the managed install\'s current binary, which updates repoint, whenever this CLI runs from that install', () => {
    mkdirSync(join(configuration.happyHomeDir, 'cli', 'current'), { recursive: true });
    writeExecutableShimSync({ dir: join(configuration.happyHomeDir, 'cli', 'current'), fileName: 'piggercode', contents: '#!/bin/sh\n' });

    // As the background service runs it: the bundled JS runtime with a versioned package path.
    const command = buildSharedFoldersServeCommand('mac', { runsManagedInstall: () => true });

    expect(command).toBe(`'${currentBinary()}' 'machine' 'shared-folders' 'serve' '--label' 'mac'`);
    expect(command).not.toContain('/versions/');
  });

  it('never names a binary that is not there to run, and uses this CLI\'s own launch anywhere else', () => {
    const missing = buildSharedFoldersServeCommand('mac', { runsManagedInstall: () => true });
    const checkout = buildSharedFoldersServeCommand('mac', { runsManagedInstall: () => false });

    for (const command of [missing, checkout]) {
      expect(command).toContain("'machine' 'shared-folders' 'serve' '--label' 'mac'");
      expect(command).not.toContain(currentBinary());
    }
  });

  it('writes each place so that the record reads it back as the same place, which is all serve trusts', () => {
    const command = buildSharedFoldersServeCommand('mac', { runsManagedInstall: () => false }, ['code', 'work/my app']);
    const line = `restrict,command="${command}" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9 piggercode-shared-folders:machine-mac`;

    expect(listAcceptedComputers(line)).toEqual([{ machineId: 'machine-mac', label: 'mac', places: ['code', 'work/my app'] }]);
  });
});
