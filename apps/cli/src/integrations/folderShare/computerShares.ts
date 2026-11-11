import { mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
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

import { readSettings, updateSettings, type SharedFolderServer, type SharedFolderSetting } from '@/persistence'
import { defaultServerLocation, parseServerLocation } from './serverLocation';
import { logger } from '@/ui/logger';

import { ensureSharedFoldersKey } from './computerKey';
import {
  openFolderConnection,
  type FolderConnection,
  type FolderConnectionEvents,
  type FolderConnectionTarget,
} from './folderConnection';
import { resolveSharingTools, type SharingToolsResult } from './sharingTools';
import {
  ensureComputerShellFiles,
  openShellLink,
  type ComputerShellFiles,
  type ShellLink,
  type ShellLinkEvents,
  type ShellLinkTarget,
} from './shellLink';

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
  /** Where its connection mounts the folder on the server; unset for a share from before places. A move starts a new runtime. */
  at: string | undefined;
  state: FolderShareState;
  error?: string;
  connection: FolderConnection | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** When the current connection was mounted on the server (`deps.now()`); unset until then. */
  connectedAt?: number;
};

type ShellRuntime = {
  spare: ShellLink | null;
  inUse: Set<ShellLink>;
  retryTimer: ReturnType<typeof setTimeout> | null;
  opening: boolean;
  /** When the spare's server answered (`deps.now()`); unset until then. */
  readyAt?: number;
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
  /**
   * Whether the account's other machines may run commands here (remote commands): a server this
   * computer shares folders with may then open a shell here, `ssh <computer>` (`shellLink.ts`).
   */
  shellAllowed?: () => Promise<boolean>;
  /** This computer's login name, the user `ssh <computer>` logs in as. */
  computerUser?: string;
  platform?: NodeJS.Platform;
  openShell?: (target: ShellLinkTarget, events: ShellLinkEvents, deps: Readonly<{ mayServe: () => Promise<boolean> }>) => ShellLink;
  ensureShellFiles?: typeof ensureComputerShellFiles;
}>): ComputerShares {
  const resolveTools = deps.resolveTools ?? (() => resolveSharingTools());
  const openConnection = deps.openConnection ?? openFolderConnection;
  const ensureKey = deps.ensureKey ?? ensureSharedFoldersKey;
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const now = deps.now ?? Date.now;
  const knownHostsPath = join(deps.stateDir, 'known_hosts');
  const runtimes = new Map<string, Runtime>();
  let stopped = false;
  const shellAllowed = deps.shellAllowed ?? (async () => false);
  const openShell = deps.openShell ?? openShellLink;
  const ensureShellFiles = deps.ensureShellFiles ?? ensureComputerShellFiles;
  const shellDir = join(deps.stateDir, 'shell');
  /** Per server this computer shares folders with: one spare shell connection, and the ones in use. */
  const shells = new Map<string, ShellRuntime>();
  let shellFiles: Promise<ComputerShellFiles> | null = null;

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
      ...(runtime.at !== undefined ? { at: runtime.at } : {}),
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

  /**
   * Keeps one spare shell connection open to the server, so `ssh <computer>` there finds one at once;
   * when a spare is used, the next one opens. A spare that drops, or that could not reach the server, comes back
   * like a share does; a server that answered that it does not open shells (older PiggerCode) is asked again only
   * at the next change of the shares.
   */
  const openSpareShell = async (serverMachineId: string, runtime: ShellRuntime): Promise<void> => {
    if (stopped || shells.get(serverMachineId) !== runtime || runtime.spare || runtime.opening) return;
    runtime.opening = true;
    try {
      const server = (await readShared()).servers[serverMachineId];
      const tools = resolveTools();
      if (!server || !tools.ok || !tools.tools.sshd) return;
      const { keyPath } = await ensureKey(deps.stateDir);
      shellFiles ??= ensureShellFiles({ shellDir, platform: deps.platform ?? process.platform, sftpServer: tools.tools.sftpServer });
      const shell = await shellFiles;
      if (stopped || shells.get(serverMachineId) !== runtime) return;
      let link: ShellLink | null = null;
      link = openShell({
        server: { user: server.user, host: server.host, port: server.port },
        keyPath,
        knownHostsPath,
        ssh: tools.tools.ssh,
        sshd: tools.tools.sshd,
        user: deps.computerUser ?? userInfo().username,
        shell,
        authorizedKeysPath: join(shellDir, `authorized_keys.${serverMachineId}`),
      }, {
        onReady: () => {
          runtime.readyAt = now();
        },
        onInUse: () => {
          if (!link || runtime.spare !== link) return;
          runtime.spare = null;
          runtime.inUse.add(link);
          delete runtime.readyAt;
          void openSpareShell(serverMachineId, runtime);
        },
        onClosed: (reason, stage) => {
          if (!link) return;
          runtime.inUse.delete(link);
          if (runtime.spare !== link) return;
          runtime.spare = null;
          const wasWaiting = runtime.readyAt !== undefined && now() - runtime.readyAt >= retryDelayMs;
          delete runtime.readyAt;
          if (stage === 'announce') {
            logger.infoFile('[SHARED FOLDERS] The server does not open a shell on this computer', { serverMachineId, reason });
            return;
          }
          retryShell(serverMachineId, runtime, wasWaiting ? 0 : retryDelayMs);
        },
      }, { mayServe: shellAllowed });
      runtime.spare = link;
    } catch (error) {
      shellFiles = null;
      logger.debug('[SHARED FOLDERS] Could not open a shell connection', { serverMachineId, error: errorMessage(error) });
      retryShell(serverMachineId, runtime, retryDelayMs);
    } finally {
      runtime.opening = false;
    }
  };

  const retryShell = (serverMachineId: string, runtime: ShellRuntime, delayMs: number) => {
    if (stopped || shells.get(serverMachineId) !== runtime || runtime.retryTimer) return;
    runtime.retryTimer = setTimeout(() => {
      runtime.retryTimer = null;
      void openSpareShell(serverMachineId, runtime);
    }, delayMs);
    runtime.retryTimer.unref?.();
  };

  const disposeShell = (runtime: ShellRuntime) => {
    if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
    runtime.retryTimer = null;
    runtime.spare?.close();
    runtime.spare = null;
    for (const link of runtime.inUse) link.close();
    runtime.inUse.clear();
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
    const wanted = new Map(shares.filter((share) => servers[share.serverMachineId]).map((share) => [shareKey(share), share.at]));
    for (const [key, runtime] of runtimes) {
      // Still shared, at the same place on the server (a share from before places has none).
      if (wanted.has(key) && wanted.get(key) === runtime.at) continue;
      dispose(runtime);
      runtimes.delete(key);
    }
    for (const [key, at] of wanted) {
      if (runtimes.has(key)) continue;
      const runtime: Runtime = { at, state: 'connecting', connection: null, retryTimer: null };
      runtimes.set(key, runtime);
      await connect(key, runtime);
    }
    const shellServers = new Set(shares.filter((share) => servers[share.serverMachineId]).map((share) => share.serverMachineId));
    for (const [serverMachineId, runtime] of shells) {
      if (shellServers.has(serverMachineId)) continue;
      disposeShell(runtime);
      shells.delete(serverMachineId);
    }
    for (const serverMachineId of shellServers) {
      let runtime = shells.get(serverMachineId);
      if (!runtime) {
        runtime = { spare: null, inUse: new Set(), retryTimer: null, opening: false };
        shells.set(serverMachineId, runtime);
      }
      void openSpareShell(serverMachineId, runtime);
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
        // A share from before places stays where it was (`~/local/<label>/<folder>`) until it is moved.
        serverPath: share.at !== undefined ? `~/${share.at}` : `${server.root}/${share.folder}`,
        state: runtime?.state ?? 'connecting',
        ...(runtime?.error ? { error: runtime.error } : {}),
      });
    }
    return { shares: listed, ...(tools.ok ? {} : { unsupported: tools.reason }) };
  };

  const changed = async (): Promise<FolderShareMutationResponse> => ({ ok: true, shares: (await list()).shares });

  /**
   * Has the server agree to every place this computer's folders show at there (the account-authenticated
   * accept request; the server writes them into the key's forced command and mounts only there), and
   * keeps how it is reached. The server's answer, or why there is none.
   */
  const agreeWithServer = async (serverMachineId: string, places: readonly string[]) => {
    const key = await ensureKey(deps.stateDir);
    const accepted = await deps.acceptOnServer(serverMachineId, {
      publicKey: key.publicKey,
      computerMachineId: deps.machineId,
      computerName: deps.machineName,
      places: [...places],
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
    }));
    await writeKnownHosts(knownHostsPath, (await readShared()).servers);
    // A server from before places mounts every folder under `~/local` and agrees to none.
    return { ok: true as const, places: accepted.places };
  };

  const add = async (request: FolderShareAddRequest): Promise<FolderShareMutationResponse> => {
    const tools = resolveTools();
    if (!tools.ok) return refused('unsupported', tools.reason);
    const resolved = await resolveFolder(deps.homeDir, request.folder);
    if (!resolved.ok) return refused('folder_not_allowed', resolved.error);
    const folder = resolved.folder;
    const serverMachineId = request.serverMachineId;
    if (serverMachineId === deps.machineId) return refused('folder_not_allowed', 'Choose another machine to share this folder with.');

    const location = parseServerLocation(request.at ?? defaultServerLocation(folder));
    if (!location.ok) return refused('folder_not_allowed', location.error);
    const at = location.at;

    const { shares } = await readShared();
    const sameServer = shares.filter((share) => share.serverMachineId === serverMachineId);
    const existing = sameServer.find((share) => share.folder === folder);
    const others = sameServer.filter((share) => share !== existing);
    if (existing?.at === at) return await changed();
    const overlapping = existing ? undefined : others.find((share) => folder.startsWith(`${share.folder}/`) || share.folder.startsWith(`${folder}/`));
    if (overlapping) {
      return refused('folder_not_allowed', `~/${folder} overlaps ~/${overlapping.folder}, which is already shared with that machine.`);
    }
    const taken = others.find((share) => share.at !== undefined && (share.at === at || at.startsWith(`${share.at}/`) || share.at.startsWith(`${at}/`)));
    if (taken) {
      return refused('folder_not_allowed', `~/${at} on that machine is where ~/${taken.folder} is shared; choose another place.`);
    }

    const agreed = await agreeWithServer(serverMachineId, [...placesOf(others), at]);
    if (!agreed.ok) return agreed;
    if (agreed.places === undefined && existing) {
      return refused('server_refused', 'That machine\'s PiggerCode is too old to place shared folders; update it, then move the folder.');
    }
    // Moving it: its connection ends (the server unmounts it) and a new one mounts it at the new place.
    // A server from before places takes a new folder under `~/local`, where it can mount it.
    const placed: SharedFolderSetting = agreed.places === undefined ? { folder, serverMachineId } : { folder, serverMachineId, at };
    await updateSettings((current) => ({
      ...current,
      sharedFolders: [
        ...(current.sharedFolders ?? []).filter((share) => !(share.serverMachineId === serverMachineId && share.folder === folder)),
        placed,
      ],
    }));
    await reconcile();
    logger.infoFile(existing ? '[SHARED FOLDERS] Moved a shared folder on its server' : '[SHARED FOLDERS] Shared a folder from the app', {
      serverMachineId,
      folderLength: folder.length,
    });
    return await changed();
  };

  const remove = async (request: FolderShareRemoveRequest): Promise<FolderShareMutationResponse> => {
    const folder = request.folder.trim().replace(/\/+$/, '');
    const onServer = (await readShared()).shares.filter((share) => share.serverMachineId === request.serverMachineId);
    const removed = onServer.find((share) => share.folder === folder);
    // First the server stops agreeing to its place, so the folder there goes once the connection ends.
    // If the server cannot be told now, the place stays agreed, unused, until the next change with it.
    if (removed?.at !== undefined) {
      const withdrawn = await agreeWithServer(request.serverMachineId, placesOf(onServer.filter((share) => share !== removed)))
        .catch((error: unknown) => refused('server_unavailable', error instanceof Error ? error.message : String(error)));
      if (!withdrawn.ok) {
        logger.warn('[SHARED FOLDERS] The server could not be told a share stopped; its place stays agreed until the next change', {
          serverMachineId: request.serverMachineId,
          reason: withdrawn.ok === false ? withdrawn.error : undefined,
        });
      }
    }
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

  /**
   * Moves a share from before places to its folder's own name on its server (`~/code`), the change the
   * app's 「更改位置…」 makes, once that server agrees (it refuses a place that holds files or another
   * computer's share). Read again first, since the app may have moved or stopped it meanwhile. One that
   * cannot move stays under `~/local` and is tried again the next time the daemon starts; after a server
   * that does not answer, its other shares wait for that too.
   */
  const placeLegacyShare = async (folder: string, serverMachineId: string, away: Set<string>): Promise<void> => {
    const share = (await readShared()).shares.find((candidate) => candidate.serverMachineId === serverMachineId && candidate.folder === folder);
    if (stopped || !share || share.at !== undefined || away.has(serverMachineId)) return;
    const moved = await add({ folder, serverMachineId });
    if (!moved.ok && moved.errorCode === 'server_unavailable') away.add(serverMachineId);
    logger.infoFile(
      moved.ok ? '[SHARED FOLDERS] Placed a share from before places at its own name' : '[SHARED FOLDERS] A share from before places stays under ~/local',
      { serverMachineId, ...(moved.ok ? {} : { reason: moved.error }) },
    );
  };

  return {
    start: async () => {
      await serialized(reconcile);
      // One at a time between the app's own changes, which wait behind each one only.
      const away = new Set<string>();
      for (const share of (await readShared()).shares.filter((candidate) => candidate.at === undefined)) {
        await serialized(() => placeLegacyShare(share.folder, share.serverMachineId, away));
      }
    },
    list,
    add: (request) => serialized(() => add(request)),
    remove: (request) => serialized(() => remove(request)),
    stop: () => {
      stopped = true;
      for (const runtime of runtimes.values()) dispose(runtime);
      runtimes.clear();
      for (const runtime of shells.values()) disposeShell(runtime);
      shells.clear();
    },
  };
}

/** The places these shares show at on their server (shares from before places have none). */
function placesOf(shares: readonly SharedFolderSetting[]): string[] {
  return shares.flatMap((share) => (share.at !== undefined ? [share.at] : []));
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
