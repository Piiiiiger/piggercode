import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';

import {
  FolderShareAcceptRequestSchema,
  type FolderShareAcceptErrorCode,
  type FolderShareAcceptResponse,
} from '@piggercode/protocol';

import { commandExistsInPath } from '@/daemon/service/commandExistsInPath';
import { readSettings } from '@/persistence';

import { acceptComputerKey } from './acceptedComputers';
import { buildSharedFoldersServeCommand } from './serveCommand';

/**
 * The server's answer when a computer of the account asks it to accept its key for shared folders
 * (`DAEMON_FOLDER_SHARE_ACCEPT`). The server must have sshfs and know the SSH address other machines
 * reach it at; then it authorizes the key for mounting into the computer's folder under `~/local` and
 * nothing else, and tells the computer how to reach it and which host keys to trust.
 */

const HOST_KEY_FILES = [
  '/etc/ssh/ssh_host_ed25519_key.pub',
  '/etc/ssh/ssh_host_ecdsa_key.pub',
  '/etc/ssh/ssh_host_rsa_key.pub',
];

export type FolderShareAcceptSystem = Readonly<{
  homeDir: string;
  userName: string;
  sshfsInstalled: () => boolean;
  readSshAddress: () => Promise<string | undefined>;
  readHostKeys: () => string[];
  serveCommand: (label: string) => string;
}>;

export async function answerFolderShareAccept(
  raw: unknown,
  system: FolderShareAcceptSystem = osAcceptSystem(),
): Promise<FolderShareAcceptResponse> {
  const parsed = FolderShareAcceptRequestSchema.safeParse(raw);
  if (!parsed.success) return refused('invalid_request', 'Invalid shared-folders request.');
  if (!system.sshfsInstalled()) {
    return refused('sshfs_missing', 'sshfs is not installed there. Install it on that machine (for example `sudo apt install sshfs`), then try again.');
  }
  const address = parseSshAddress(await system.readSshAddress());
  if (!address) {
    return refused(
      'ssh_address_missing',
      'That machine does not know the SSH address other machines reach it at. On it, run `piggercode machine shared-folders address <host[:port]>`, then try again.',
    );
  }
  const hostKeys = system.readHostKeys();
  if (hostKeys.length === 0) return refused('host_keys_missing', 'That machine’s SSH host keys cannot be read.');

  let label: string;
  try {
    ({ label } = await acceptComputerKey({
      homeDir: system.homeDir,
      machineId: parsed.data.computerMachineId,
      computerName: parsed.data.computerName,
      publicKey: parsed.data.publicKey,
      serveCommand: system.serveCommand,
    }));
  } catch (error) {
    return refused('invalid_request', error instanceof Error ? error.message : 'Invalid shared-folders request.');
  }
  return {
    ok: true,
    ssh: { user: system.userName, host: address.host, port: address.port, hostKeys },
    root: `~/local/${label}`,
  };
}

/**
 * `host`, `host:port`, `[ipv6]:port` or a bare IPv6 address; the port defaults to 22. Null when the
 * address is missing or not one of those.
 */
export function parseSshAddress(text: string | undefined): Readonly<{ host: string; port: number }> | null {
  const value = text?.trim() ?? '';
  if (!value || /[\s@/]/.test(value)) return null;
  let host = value;
  let port = 22;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (bracketed) {
    host = bracketed[1]!;
    if (bracketed[2]) port = Number(bracketed[2]);
  } else if ((value.match(/:/g) ?? []).length === 1) {
    const [name, portText] = value.split(':');
    if (!name || !portText || !/^\d+$/.test(portText)) return null;
    host = name;
    port = Number(portText);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port };
}

function refused(errorCode: FolderShareAcceptErrorCode, error: string): FolderShareAcceptResponse {
  return { ok: false, errorCode, error };
}

function osAcceptSystem(): FolderShareAcceptSystem {
  return {
    homeDir: homedir(),
    userName: userInfo().username,
    sshfsInstalled: () => commandExistsInPath({ cmd: 'sshfs', envPath: process.env.PATH, platform: process.platform }),
    readSshAddress: async () => (await readSettings()).sharedFoldersSshAddress,
    readHostKeys: () => HOST_KEY_FILES.flatMap((file) => {
      try {
        const [type, data] = readFileSync(file, 'utf8').trim().split(/\s+/);
        return type && data ? [`${type} ${data}`] : [];
      } catch {
        return [];
      }
    }),
    serveCommand: buildSharedFoldersServeCommand,
  };
}
