import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tmuxTmpDirSharedFolderProblem } from './tmuxTmpDirSharedFolderProblem';

describe('tmuxTmpDirSharedFolderProblem', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    // A real home whose authorized_keys lets the computer "laptop" mount a folder at ~/code; nothing is mounted there.
    home = mkdtempSync(join(tmpdir(), 'piggercode-tmux-share-home-'));
    mkdirSync(join(home, '.ssh'));
    writeFileSync(join(home, '.ssh', 'authorized_keys'), `restrict,command="'/opt/piggercode' 'machine' 'shared-folders' 'serve' '--label' 'laptop' '--place' 'code'" `
      + 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9 piggercode-shared-folders:machine-1\n');
    previousHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('names the computer when the tmux socket folder lies in its shared folder while it is away', async () => {
    expect(await tmuxTmpDirSharedFolderProblem(join(home, 'code', 'tmux'))).toContain('laptop');
  });

  it('lets a socket folder elsewhere, or none at all, go ahead', async () => {
    expect(await tmuxTmpDirSharedFolderProblem(join(home, '.piggercode', 'tmux'))).toBeNull();
    expect(await tmuxTmpDirSharedFolderProblem(null)).toBeNull();
  });
});
