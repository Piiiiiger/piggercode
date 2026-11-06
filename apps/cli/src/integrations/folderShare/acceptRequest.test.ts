import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { answerFolderShareAccept, parseSshAddress, type FolderShareAcceptSystem } from './acceptRequest';
import { listAcceptedComputers } from './acceptedComputers';

const COMPUTER_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';
const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINQKK0TckxnFot3LMp0B+2WElapYHkD6E8fo78SadK/n';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function createSystem(overrides: Partial<FolderShareAcceptSystem> = {}): FolderShareAcceptSystem {
  const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-accept-'));
  homes.push(home);
  return {
    homeDir: home,
    userName: 'pigger',
    sshfsInstalled: () => true,
    readSshAddress: async () => 'server.example.test:2200',
    readHostKeys: () => [HOST_KEY],
    serveCommand: (label, places) => `/srv/piggercode machine shared-folders serve --label ${label}${places.map((place) => ` --place '${place}'`).join('')}`,
    ...overrides,
  };
}

const request = { publicKey: COMPUTER_KEY, computerMachineId: 'machine-laptop', computerName: 'laptop' };

describe('a server asked to accept a computer’s shared folders', () => {
  it('authorizes the key for the computer’s folder and says how to reach it', async () => {
    const system = createSystem();

    const answer = await answerFolderShareAccept(request, system);

    expect(answer).toEqual({
      ok: true,
      ssh: { user: 'pigger', host: 'server.example.test', port: 2200, hostKeys: [HOST_KEY] },
      root: '~/local/laptop',
      places: [],
    });
    const authorized = readFileSync(join(system.homeDir, '.ssh', 'authorized_keys'), 'utf8');
    expect(listAcceptedComputers(authorized)).toEqual([{ machineId: 'machine-laptop', label: 'laptop', places: [] }]);
  });

  it('answers with the places it agreed to, and refuses one it cannot', async () => {
    const system = createSystem();

    expect(await answerFolderShareAccept({ ...request, places: ['code'] }, system)).toMatchObject({ ok: true, places: ['code'] });
    expect(await answerFolderShareAccept({ ...request, places: ['.ssh'] }, system)).toMatchObject({ ok: false, errorCode: 'invalid_request' });
  });

  it('declines, with what to do about it, when it cannot mount or cannot be reached', async () => {
    const noSshfs = createSystem({ sshfsInstalled: () => false });
    expect(await answerFolderShareAccept(request, noSshfs)).toMatchObject({ ok: false, errorCode: 'sshfs_missing', error: expect.stringMatching(/sshfs/) });

    const noAddress = createSystem({ readSshAddress: async () => undefined });
    expect(await answerFolderShareAccept(request, noAddress)).toMatchObject({
      ok: false,
      errorCode: 'ssh_address_missing',
      error: expect.stringContaining('piggercode machine shared-folders address'),
    });

    const noHostKeys = createSystem({ readHostKeys: () => [] });
    expect(await answerFolderShareAccept(request, noHostKeys)).toMatchObject({ ok: false, errorCode: 'host_keys_missing' });

    for (const system of [noSshfs, noAddress, noHostKeys]) {
      expect(() => readFileSync(join(system.homeDir, '.ssh', 'authorized_keys'))).toThrow();
    }
  });

  it('declines a malformed request or key without touching authorized_keys', async () => {
    const system = createSystem();
    expect(await answerFolderShareAccept({ publicKey: COMPUTER_KEY }, system)).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(await answerFolderShareAccept({ ...request, publicKey: `no-pty ${COMPUTER_KEY}` }, system)).toMatchObject({
      ok: false,
      errorCode: 'invalid_request',
    });
    expect(() => readFileSync(join(system.homeDir, '.ssh', 'authorized_keys'))).toThrow();
  });
});

describe('the SSH address a server is reached at', () => {
  it('reads host, host:port and IPv6 forms, with 22 as the default port', () => {
    expect(parseSshAddress('server.example.test')).toEqual({ host: 'server.example.test', port: 22 });
    expect(parseSshAddress(' 203.0.113.7:2200 ')).toEqual({ host: '203.0.113.7', port: 2200 });
    expect(parseSshAddress('[2001:db8::1]:2200')).toEqual({ host: '2001:db8::1', port: 2200 });
    expect(parseSshAddress('2001:db8::1')).toEqual({ host: '2001:db8::1', port: 22 });
  });

  it('rejects anything else', () => {
    for (const value of [undefined, '', 'user@host', 'host:', 'host:0', 'host:70000', 'host:22x', 'two words', 'ssh://host']) {
      expect(parseSshAddress(value), String(value)).toBeNull();
    }
  });
});
