import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listSharedFolderRoots } from './sharedFolderRoots';

// A throwaway public key (its private half was never kept).
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function serverHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-roots-'));
  homes.push(home);
  mkdirSync(join(home, '.ssh'), { mode: 0o700 });
  writeFileSync(
    join(home, '.ssh', 'authorized_keys'),
    `restrict,command="'/x/cli/current/piggercode' 'machine' 'shared-folders' 'serve' '--label' 'macbook-air'" ${KEY} piggercode-shared-folders:machine-mac\n`,
    { mode: 0o600 },
  );
  return home;
}

/** /proc/self/mountinfo lines: the computer's sshfs mount, and mounts that are not shared folders. */
function mountinfo(home: string): string {
  return [
    `25 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw`,
    `36 25 0:31 / ${home}/local/macbook-air/code rw,nosuid,nodev,relatime shared:5 - fuse.sshfs code rw,user_id=1000,group_id=1000`,
    `37 25 0:32 / ${home}/elsewhere rw,nosuid,nodev,relatime shared:6 - fuse.sshfs other rw,user_id=1000,group_id=1000`,
    '',
  ].join('\n');
}

describe('the folders of the user\'s computers mounted on this server, as browse roots', () => {
  it('lists each mounted folder with the computer it belongs to', async () => {
    const home = serverHome();

    expect(await listSharedFolderRoots({ homeDir: home, mountinfo: mountinfo(home) })).toEqual([{
      id: `shared-folder:${home}/local/macbook-air/code`,
      label: 'macbook-air/code',
      path: `${home}/local/macbook-air/code`,
      sharedFolder: { folder: 'code', computerMachineId: 'machine-mac' },
    }]);
  });

  it('has none while nothing is mounted under ~/local', async () => {
    const home = serverHome();
    expect(await listSharedFolderRoots({ homeDir: home, mountinfo: `25 1 8:1 / / rw - ext4 /dev/sda1 rw\n` })).toEqual([]);
  });
});
