import { mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import type {
  FolderShare,
  FolderShareAcceptRequest,
  FolderShareAcceptResponse,
  FolderShareAddRequest,
  FolderShareErrorCode,
  FolderShareListResponse,
  FolderShareMutationResponse,
  FolderShareRemoveRequest,
  FolderShareState,
} from '@piggercode/protocol';

import { readSettings, updateSettings, type SharedFolderServer, type SharedFolderSetting } from '@/persistence';
import { logger } from '@/ui/logger';

import { ensureSharedFoldersKey } from './computerKey';
import {
  openFolderConnection,
  type FolderConnection,
  type FolderConnectionEvents,
  type FolderConnectionTarget,
} from './folderConnection';
import { resolveSharingTools, type SharingToolsResult } from './sharingTools';

/**
 * The folders this computer shares with servers of its account, and their one owner. The settings hold
 * what is shared (`sharedFolders`) and how each server is reached (`sharedFolderServers`, as that
 * server's accept answered); the connections keep each shared folder mounted on its server and come
 * back by themselves after a drop. The app's machine screen reaches it through this machine's daemon
 * (`registerFolderShareHandlers`).
 */

/**
 * The wait before a share connects again after an attempt failed: soon enough to come back shortly
 * after a network change or a server restart, slow enough not to hammer a server that keeps refusing.
 * A connection that had been working for at least this long is tried again at once when it ends —
 * a restart or a network change, not a server that refuses.
 */
const RETRY_DELAY_MS = 15_000;

/** Asks the server to accept this computer's key; `unavailable` when the server did not answer. */
export type AcceptOnServer = (
  serverMachineId: string,
  request: FolderShareAcceptRequest,
) => Promise<FolderShareAcceptResponse | 'unavailable'>;

export type ComputerShares = Readonly<{
  /** Connects the shares in the settings (at daemon start). */
  start: () => Promise<void>;
  list: () => Promise<FolderShareListResponse>;
  add: (request: FolderShareAddRequest) => Promise<FolderShareMutationResponse>;
  remove: (request: FolderShareRemoveRequest) => Promise<FolderShareMutationResponse>;
  /** Ends every connection (daemon shutdown); the shares stay in the settings. */
  stop: () => void;
}>;

type Runtime = {
  state: FolderShareState;
  error?: string;
  connection: FolderConnection | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** When the current connection was mounted on the server (`deps.now()`); unset until then. */
  connectedAt?: number;
};

const HOST_KEY_PATTERN = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/]+={0,2}$/;
const SSH_WORD_PATTERN = /^[A-Za-z0-9._:\-[\]]+$/;

export function createComputerShares(deps: Readonly<{
  machineId: string;
  machineName: string;
  /** This user's home, as a real path. */
  homeDir: string;
  /** Where the key and the trusted host keys live (`<PiggerCode home>/shared-folders`). */
  stateDir: string;
  acceptOnServer: AcceptOnServer;
  resolveTools?: () => SharingToolsResult;
  openConnection?: (target: FolderConnectionTarget, events: FolderConnectionEvents) => FolderConnection;
  ensureKey?: (dir: string) => Promise<Readonly<{ keyPath: string; publicKey: string }>>;
  retryDelayMs?: number;
  /** Test seam: the clock that says how long a connection had been working. */
  now?: () => number;
}>): ComputerShares {
  const resolveTools = deps.resolveTools ?? (() => resolveSharingTools());
  const openConnection = deps.openConnection ?? openFolderConnection;
  const ensureKey = deps.ensureKey ?? ensureSharedFoldersKey;
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const now = deps.now ?? Date.now;
  const knownHostsPath = join(deps.stateDir, 'known_hosts');
  const runtimes = new Map<string, Runtime>();
  let stopped = false;

  // Adding, removing and (re)connecting read the settings and then act on them; one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work);
    queue = run.then(() => undefined, () => undefined);
    return run;
  };

  const fail = (key: string, runtime: Runtime, reason: string, delayMs: number = retryDelayMs) => {
    if (stopped || runtimes.get(key) !== runtime) return;
    runtime.state = 'retrying';
    runtime.error = reason;
    logger.debug('[SHARED FOLDERS] A share is not connected; trying again', { reason, delayMs });
    runtime.retryTimer = setTimeout(() => {
      runtime.retryTimer = null;
      void serialized(() => connect(key, runtime));
    }, delayMs);
    runtime.retryTimer.unref?.();
  };

  const connect = async (key: string, runtime: Runtime): Promise<void> => {
    if (stopped || runtimes.get(key) !== runtime) return;
    const { shares, servers } = await readShared();
    const share = shares.find((candidate) => shareKey(candidate) === key);
    const server = share ? servers[share.serverMachineId] : undefined;
    if (!share || !server) return;
    const tools = resolveTools();
    if (!tools.ok) {
      fail(key, runtime, tools.reason);
      return;
    }
    let keyPath: string;
    try {
      keyPath = (await ensureKey(deps.stateDir)).keyPath;
    } catch (error) {
      fail(key, runtime, errorMessage(error));
      return;
    }
    runtime.state = 'connecting';
    delete runtime.error;
    runtime.connection = openConnection({
      folder: share.folder,
      folderPath: join(deps.homeDir, share.folder),
      homeDir: deps.homeDir,
      server: { user: server.user, host: server.host, port: server.port },
      keyPath,
      knownHostsPath,
      tools: tools.tools,
    }, {
      onConnected: () => {
        if (runtimes.get(key) !== runtime) return;
        runtime.state = 'connected';
        runtime.connectedAt = now();
        delete runtime.error;
      },
      onClosed: (reason) => {
        const wasWorking = runtime.connectedAt !== undefined && now() - runtime.connectedAt >= retryDelayMs;
        runtime.connection = null;
        delete runtime.connectedAt;
        fail(key, runtime, reason, wasWorking ? 0 : retryDelayMs);
      },
    });
  };

  const dispose = (runtime: Runtime) => {
    if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
    runtime.retryTimer = null;
    runtime.connection?.close();
    runtime.connection = null;
  };

  /** Starts the shares the settings name that are not running, and ends the ones they no longer name. */
  const reconcile = async (): Promise<void> => {
    if (stopped) return;
    const { shares, servers } = await readShared();
    const wanted = new Set(shares.filter((share) => servers[share.serverMachineId]).map(shareKey));
    for (const [key, runtime] of runtimes) {
      if (wanted.has(key)) continue;
      dispose(runtime);
      runtimes.delete(key);
    }
    for (const key of wanted) {
      if (runtimes.has(key)) continue;
      const runtime: Runtime = { state: 'connecting', connection: null, retryTimer: null };
      runtimes.set(key, runtime);
      await connect(key, runtime);
    }
  };

  const list = async (): Promise<FolderShareListResponse> => {
    const { shares, servers } = await readShared();
    const tools = resolveTools();
    const listed: FolderShare[] = [];
    for (const share of shares) {
      const server = servers[share.serverMachineId];
      if (!server) continue;
      const runtime = runtimes.get(shareKey(share));
      listed.push({
        folder: share.folder,
        serverMachineId: share.serverMachineId,
        serverPath: `${server.root}/${share.folder}`,
        state: runtime?.state ?? 'connecting',
        ...(runtime?.error ? { error: runtime.error } : {}),
      });
    }
    return { shares: listed, ...(tools.ok ? {} : { unsupported: tools.reason }) };
  };

  const changed = async (): Promise<FolderShareMutationResponse> => ({ ok: true, shares: (await list()).shares });

  const add = async (request: FolderShareAddRequest): Promise<FolderShareMutationResponse> => {
    const tools = resolveTools();
    if (!tools.ok) return refused('unsupported', tools.reason);
    const resolved = await resolveFolder(deps.homeDir, request.folder);
    if (!resolved.ok) return refused('folder_not_allowed', resolved.error);
    const folder = resolved.folder;
    const serverMachineId = request.serverMachineId;
    if (serverMachineId === deps.machineId) return refused('folder_not_allowed', 'Choose another machine to share this folder with.');

    const { shares } = await readShared();
    const sameServer = shares.filter((share) => share.serverMachineId === serverMachineId);
    if (sameServer.some((share) => share.folder === folder)) return await changed();
    const overlapping = sameServer.find((share) => folder.startsWith(`${share.folder}/`) || share.folder.startsWith(`${folder}/`));
    if (overlapping) {
      return refused('folder_not_allowed', `~/${folder} overlaps ~/${overlapping.folder}, which is already shared with that machine.`);
    }

    const key = await ensureKey(deps.stateDir);
    const accepted = await deps.acceptOnServer(serverMachineId, {
      publicKey: key.publicKey,
      computerMachineId: deps.machineId,
      computerName: deps.machineName,
    });
    if (accepted === 'unavailable') {
      return refused('server_unavailable', 'That machine did not answer. It may be offline, or its PiggerCode may be too old for shared folders.');
    }
    if (!accepted.ok) return refused('server_refused', accepted.error);
    const server: SharedFolderServer = {
      user: accepted.ssh.user,
      host: accepted.ssh.host,
      port: accepted.ssh.port,
      hostKeys: accepted.ssh.hostKeys,
      root: accepted.root,
    };
    if (!isUsableServer(server)) return refused('server_refused', 'That machine answered with an address or host keys that cannot be used.');

    await updateSettings((current) => ({
      ...current,
      sharedFolderServers: { ...(current.sharedFolderServers ?? {}), [serverMachineId]: server },
      sharedFolders: [
        ...(current.sharedFolders ?? []).filter((share) => !(share.serverMachineId === serverMachineId && share.folder === folder)),
        { folder, serverMachineId },
      ],
    }));
    await writeKnownHosts(knownHostsPath, (await readShared()).servers);
    await reconcile();
    logger.infoFile('[SHARED FOLDERS] Shared a folder from the app', { serverMachineId, folderLength: folder.length });
    return await changed();
  };

  const remove = async (request: FolderShareRemoveRequest): Promise<FolderShareMutationResponse> => {
    const folder = request.folder.trim().replace(/\/+$/, '');
    await updateSettings((current) => ({
      ...current,
      sharedFolders: (current.sharedFolders ?? []).filter(
        (share) => !(share.serverMachineId === request.serverMachineId && share.folder === folder),
      ),
    }));
    await reconcile();
    logger.infoFile('[SHARED FOLDERS] Stopped sharing a folder from the app', { serverMachineId: request.serverMachineId });
    return await changed();
  };

  return {
    start: () => serialized(reconcile),
    list,
    add: (request) => serialized(() => add(request)),
    remove: (request) => serialized(() => remove(request)),
    stop: () => {
      stopped = true;
      for (const runtime of runtimes.values()) dispose(runtime);
      runtimes.clear();
    },
  };
}

function shareKey(share: Readonly<{ serverMachineId: string; folder: string }>): string {
  return `${share.serverMachineId}\n${share.folder}`;
}

async function readShared(): Promise<Readonly<{ shares: SharedFolderSetting[]; servers: Record<string, SharedFolderServer> }>> {
  const settings = await readSettings();
  return { shares: settings.sharedFolders ?? [], servers: settings.sharedFolderServers ?? {} };
}

function refused(errorCode: FolderShareErrorCode, error: string): FolderShareMutationResponse {
  return { ok: false, errorCode, error };
}

/** A folder inside the home (not the home itself), as a path relative to it with `/` separators. */
async function resolveFolder(
  homeDir: string,
  input: string,
): Promise<Readonly<{ ok: true; folder: string }> | Readonly<{ ok: false; error: string }>> {
  const trimmed = input.trim();
  const candidate = trimmed === '~'
    ? homeDir
    : trimmed.startsWith('~/')
      ? join(homeDir, trimmed.slice(2))
      : isAbsolute(trimmed) ? trimmed : join(homeDir, trimmed);
  let path: string;
  try {
    path = await realpath(candidate);
  } catch {
    return { ok: false, error: 'That folder does not exist on this computer.' };
  }
  if (!(await stat(path)).isDirectory()) return { ok: false, error: 'Choose a folder, not a file.' };
  const folder = relative(homeDir, path).split(sep).join('/');
  if (!folder || folder === '..' || folder.startsWith('../') || isAbsolute(folder)) {
    return { ok: false, error: 'Share a folder inside your home folder: not the home folder itself, and nothing outside it.' };
  }
  if (folder.split('/').some((segment) => segment.startsWith('-')) || /[\x00-\x1f\x7f]/.test(folder)) {
    return { ok: false, error: 'A folder with this name cannot be shared.' };
  }
  return { ok: true, folder };
}

function isUsableServer(server: SharedFolderServer): boolean {
  return SSH_WORD_PATTERN.test(server.user)
    && !server.user.includes('@')
    && SSH_WORD_PATTERN.test(server.host)
    && server.hostKeys.length > 0
    && server.hostKeys.every((key) => HOST_KEY_PATTERN.test(key))
    && server.root.startsWith('~/')
    && !/[\x00-\x1f\x7f]/.test(server.root);
}

/** The host keys of every server this computer shares with, the only ones its connections trust. */
async function writeKnownHosts(path: string, servers: Record<string, SharedFolderServer>): Promise<void> {
  const lines: string[] = [];
  for (const server of Object.values(servers)) {
    const host = server.port === 22 ? server.host : `[${server.host}]:${server.port}`;
    for (const key of server.hostKeys) lines.push(`${host} ${key}`);
  }
  const directory = join(path, '..');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, lines.length > 0 ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  await rename(temporary, path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
