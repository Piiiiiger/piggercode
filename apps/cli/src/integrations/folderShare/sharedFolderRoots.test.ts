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

/** /proc/self/mountinfo lines: the computer's mount where the user placed it, one from before locations, and others. */
function mountinfo(home: string): string {
  return [
    `25 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw`,
    `36 25 0:31 / ${home}/code rw,nosuid,nodev,relatime shared:5 - fuse.sshfs piggercode:macbook-air:code rw,user_id=1000,group_id=1000`,
    `37 25 0:32 / ${home}/local/macbook-air/notes rw,nosuid,nodev,relatime shared:6 - fuse.sshfs :notes rw,user_id=1000,group_id=1000`,
    `38 25 0:33 / ${home}/elsewhere rw,nosuid,nodev,relatime shared:7 - fuse.sshfs other rw,user_id=1000,group_id=1000`,
    '',
  ].join('\n');
}

describe('the folders of the user\'s computers mounted on this server, as browse roots', () => {
  it('lists each mounted folder by where it is, with the computer it belongs to', async () => {
    const home = serverHome();

    expect(await listSharedFolderRoots({ homeDir: home, mountinfo: mountinfo(home) })).toEqual([
      {
        id: `shared-folder:${home}/code`,
        label: '~/code',
        path: `${home}/code`,
        sharedFolder: { folder: 'code', computerLabel: 'macbook-air', computerMachineId: 'machine-mac' },
      },
      {
        id: `shared-folder:${home}/local/macbook-air/notes`,
        label: '~/local/macbook-air/notes',
        path: `${home}/local/macbook-air/notes`,
        sharedFolder: { folder: 'notes', computerLabel: 'macbook-air', computerMachineId: 'machine-mac' },
      },
    ]);
  });

  it('has none while no computer\'s folder is mounted', async () => {
    const home = serverHome();
    expect(await listSharedFolderRoots({ homeDir: home, mountinfo: `25 1 8:1 / / rw - ext4 /dev/sda1 rw\n` })).toEqual([]);
  });
});
