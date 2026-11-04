import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureSharedFoldersKey } from './computerKey';
import { parseComputerPublicKey } from './acceptedComputers';

const hasKeygen = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' }).error === undefined;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(!hasKeygen)('this computer’s key for shared folders', () => {
  it('is made once, kept private, and sent in the form a server accepts', async () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-key-')), 'shared-folders');
    directories.push(join(directory, '..'));

    const first = await ensureSharedFoldersKey(directory);
    const again = await ensureSharedFoldersKey(directory);

    expect(again).toEqual(first);
    expect(parseComputerPublicKey(first.publicKey)).toBe(first.publicKey);
    expect(statSync(first.keyPath).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });
});
