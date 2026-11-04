import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSharedFoldersPromptBlocks } from './sharedFoldersPromptBlocks';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function createHome(authorizedKeys: string | null): string {
  const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-prompt-'));
  homes.push(home);
  if (authorizedKeys !== null) {
    mkdirSync(join(home, '.ssh'));
    writeFileSync(join(home, '.ssh', 'authorized_keys'), authorizedKeys);
  }
  return home;
}

const OWNER_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINQKK0TckxnFot3LMp0B+2WElapYHkD6E8fo78SadK/n owner@laptop';
const COMPUTER_LINE = 'restrict,command="\'/opt/piggercode\' \'machine\' \'shared-folders\' \'serve\' \'--label\' \'laptop\'" '
  + 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9 piggercode-shared-folders:machine-laptop';

describe('what agents on a server are told about shared folders', () => {
  it('names each computer’s folder under ~/local and where its commands run', async () => {
    const blocks = await resolveSharedFoldersPromptBlocks(createHome(`${OWNER_LINE}\n${COMPUTER_LINE}\n`));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.scope).toBe('session');
    expect(blocks[0]!.text).toContain('~/local/laptop/ is computer machine id machine-laptop');
    expect(blocks[0]!.text).toContain('machine_command_run');
  });

  it('says nothing on a machine that accepts no shared folders', async () => {
    expect(await resolveSharedFoldersPromptBlocks(createHome(`${OWNER_LINE}\n`))).toEqual([]);
    expect(await resolveSharedFoldersPromptBlocks(createHome(null))).toEqual([]);
  });
});
