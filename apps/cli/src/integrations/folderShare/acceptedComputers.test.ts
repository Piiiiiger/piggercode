import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  acceptComputerKey,
  listAcceptedComputers,
  parseComputerPublicKey,
} from './acceptedComputers';

// Throwaway public keys (their private halves were never kept).
const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINYO635KmTy+ISPzZ3SWwxIbC3GRHZo3HbNGoSyzjZfS';
const OWNER_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINQKK0TckxnFot3LMp0B+2WElapYHkD6E8fo78SadK/n owner@laptop';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function createHome(authorizedKeys?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'piggercode-shared-folders-home-'));
  homes.push(home);
  if (authorizedKeys !== undefined) {
    mkdirSync(join(home, '.ssh'), { mode: 0o700 });
    writeFileSync(join(home, '.ssh', 'authorized_keys'), authorizedKeys, { mode: 0o600 });
  }
  return home;
}

const serveCommand = (label: string) => `/opt/piggercode/bin/piggercode machine shared-folders serve --label ${label}`;

function readAuthorizedKeys(home: string): string {
  return readFileSync(join(home, '.ssh', 'authorized_keys'), 'utf8');
}

describe('a computer key accepted for shared folders', () => {
  it('lets the key do nothing but mount into the computer’s own folder, and keeps the owner’s keys', async () => {
    const home = createHome(`${OWNER_LINE}\n`);

    const accepted = await acceptComputerKey({
      homeDir: home,
      machineId: 'machine-laptop',
      computerName: 'Laptop',
      publicKey: KEY_A,
      serveCommand,
    });

    expect(accepted).toEqual({ label: 'laptop' });
    const lines = readAuthorizedKeys(home).trim().split('\n');
    expect(lines[0]).toBe(OWNER_LINE);
    expect(lines[1]).toBe(
      `restrict,command="${serveCommand('laptop')}" ${KEY_A} piggercode-shared-folders:machine-laptop`,
    );
    expect(listAcceptedComputers(readAuthorizedKeys(home))).toEqual([{ machineId: 'machine-laptop', label: 'laptop' }]);
    expect(statSync(join(home, '.ssh', 'authorized_keys')).mode & 0o777).toBe(0o600);
  });

  it('replaces the computer’s earlier key on the same folder instead of adding a second line', async () => {
    const home = createHome(`${OWNER_LINE}\n`);
    await acceptComputerKey({ homeDir: home, machineId: 'machine-laptop', computerName: 'laptop', publicKey: KEY_A, serveCommand });

    const again = await acceptComputerKey({
      homeDir: home,
      machineId: 'machine-laptop',
      computerName: 'Renamed Laptop',
      publicKey: KEY_B,
      serveCommand,
    });

    expect(again).toEqual({ label: 'laptop' });
    const text = readAuthorizedKeys(home);
    expect(text).not.toContain(KEY_A);
    expect(text).toContain(KEY_B);
    expect(listAcceptedComputers(text)).toEqual([{ machineId: 'machine-laptop', label: 'laptop' }]);
  });

  it('gives a second computer with the same name its own folder', async () => {
    const home = createHome();
    await acceptComputerKey({ homeDir: home, machineId: 'machine-one', computerName: 'pigger', publicKey: KEY_A, serveCommand });

    const second = await acceptComputerKey({
      homeDir: home,
      machineId: 'Zx9-other',
      computerName: 'pigger',
      publicKey: KEY_B,
      serveCommand,
    });

    expect(second.label).not.toBe('pigger');
    expect(second.label).toMatch(/^pigger-[a-z0-9]+$/);
    expect(listAcceptedComputers(readAuthorizedKeys(home)).map((computer) => computer.label)).toEqual(['pigger', second.label]);
    expect(statSync(join(home, '.ssh')).mode & 0o777).toBe(0o700);
  });

  it('names the folder after the computer in characters that are safe in a path and a command', async () => {
    const home = createHome();
    const accepted = await acceptComputerKey({
      homeDir: home,
      machineId: 'machine-mac',
      computerName: ' Pigger’s MacBook Pro (2026) ',
      publicKey: KEY_A,
      serveCommand,
    });
    expect(accepted.label).toBe('pigger-s-macbook-pro-2026');

    const unnamed = await acceptComputerKey({ homeDir: home, machineId: 'machine-x', computerName: '电脑', publicKey: KEY_B, serveCommand });
    expect(unnamed.label).toMatch(/^computer(-[a-z0-9]+)?$/);
  });

  it('refuses anything but a bare ed25519 key, so a request cannot add options or lines', () => {
    expect(parseComputerPublicKey(KEY_A)).toBe(KEY_A);
    expect(parseComputerPublicKey(`${KEY_A}\n`)).toBe(KEY_A);
    expect(parseComputerPublicKey(`${KEY_A} comment`)).toBeNull();
    expect(parseComputerPublicKey(`command="sh" ${KEY_A}`)).toBeNull();
    expect(parseComputerPublicKey(`${KEY_A}\nssh-ed25519 AAAA`)).toBeNull();
    expect(parseComputerPublicKey('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ')).toBeNull();
    expect(parseComputerPublicKey('ssh-ed25519 AAAAB3NzaC1yc2EAAAADAQABAAABAQ')).toBeNull();
  });

  it('refuses machine ids that are not plain identifiers', async () => {
    const home = createHome();
    await expect(acceptComputerKey({
      homeDir: home,
      machineId: 'x" ssh-ed25519 AAAA',
      computerName: 'laptop',
      publicKey: KEY_A,
      serveCommand,
    })).rejects.toThrow(/machine id/i);
  });
});
