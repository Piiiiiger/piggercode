import { join } from 'node:path';
import { existsSync } from 'node:fs';

import {
  acquireSingleFlightLock,
  releaseSingleFlightLock,
  compareVersions,
  type DetachedSpawnResult,
  doesVersionMatchReleaseRing,
  formatUpdateNotice,
  readUpdateCache,
  resolveCliUpdateCachePath,
  resolveCliUpdateCheckLockPath,
  shouldNotifyUpdate,
  spawnDetachedNode,
  writeUpdateCache,
} from '@piggercode/cli-common/update';
import { resolveManagedCliToolNameForRing } from '@piggercode/cli-common/firstPartyRuntime';
import type { PublicReleaseRingId } from '@piggercode/release-runtime/releaseRings';
import { readStartedByArg } from '@/cli/readStartedByArg';
import { parseRuntimeContextPrefixArgs } from '@/utils/env/runtimeContextArgv';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECK_LOCK_TTL_MS = 2 * 60 * 1000;
/** When the spawning process took the check lock, so the spawned check can give back exactly that lock. */
const SPAWNED_CHECK_LOCK_ENV_KEY = 'PIGGERCODE_CLI_UPDATE_CHECK_LOCK_ACQUIRED_AT';

function envNumber(env: NodeJS.ProcessEnv, key: string): number | null {
  const raw = String(env[key] ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function updateChecksEnabled(env: NodeJS.ProcessEnv): boolean {
  return String(env.PIGGERCODE_CLI_UPDATE_CHECK ?? '1').trim() !== '0';
}

function resolveSelfChannelArgs(ring: PublicReleaseRingId): string[] {
  if (ring === 'preview') return ['--preview'];
  if (ring === 'publicdev') return ['--dev'];
  return [];
}

function resolveUpdateCommand(ring: PublicReleaseRingId): string {
  return `${resolveManagedCliToolNameForRing(ring)} self update`;
}

const LONG_FLAGS_WITH_VALUE = new Set([
  '--config',
  '--server',
  '--server-url',
  '--webapp-url',
  '--public-server-url',
]);

function getCmdFromArgv(argv: string[]): string {
  argv = parseRuntimeContextPrefixArgs(argv).args;
  // Heuristic: treat leading "--flag value" pairs as global options so we can
  // reliably identify the command for update-notice suppression (e.g. `self`).
  let skipNext = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (!token) continue;
    if (token.startsWith('--')) {
      // Handle "--flag=value" as a single token.
      if (!token.includes('=') && LONG_FLAGS_WITH_VALUE.has(token)) skipNext = true;
      continue;
    }
    if (token.startsWith('-')) {
      // Handle "-f value" pairs as global options.
      // We intentionally avoid trying to parse combined flags (e.g. "-abc").
      if (/^-[A-Za-z]$/.test(token)) {
        const next = argv[i + 1];
        if (typeof next === 'string' && next.length > 0 && !next.startsWith('-')) {
          skipNext = true;
        }
      }
      continue;
    }
    return token;
  }
  return 'help';
}

function isVersionInvocation(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

function resolveUpdateCheckEntrypoint(cliRootDir: string): string {
  const normalizedRoot = String(cliRootDir ?? '').trim();
  const packageDistEntrypoint = join(normalizedRoot, 'package-dist', 'index.mjs');
  if (existsSync(packageDistEntrypoint)) {
    return packageDistEntrypoint;
  }
  return join(normalizedRoot, 'dist', 'index.mjs');
}

/**
 * The existing background refresh of the channel's update cache: when the cached check is older
 * than the check interval, spawn one detached `self check --quiet` under the single-flight lock.
 * Callers without a terminal (the desktop's ambient status read) use it too, so the cached state
 * they report stays fresh without a network call on their own path.
 */
export function maybeRefreshCliUpdateCacheInBackground(params: Readonly<{
  homeDir: string;
  cliRootDir: string;
  env: NodeJS.ProcessEnv;
  publicReleaseRing: PublicReleaseRingId;
  nowMs?: number;
  checkIntervalMs?: number;
  spawnDetached?: (args: { script: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }) => DetachedSpawnResult | void;
}>): void {
  const env = params.env;
  if (!updateChecksEnabled(env)) return;
  if (String(env.PIGGERCODE_CLI_UPDATE_CHECK_SPAWNED ?? '').trim() === '1') return;
  const now = params.nowMs ?? Date.now();
  const cached = readUpdateCache(resolveCliUpdateCachePath({ homeDir: params.homeDir, publicReleaseRing: params.publicReleaseRing }));
  const checkedAt = typeof cached?.checkedAt === 'number' ? cached.checkedAt : 0;
  const checkInterval =
    params.checkIntervalMs ??
    envNumber(env, 'PIGGERCODE_CLI_UPDATE_CHECK_INTERVAL_MS') ??
    DEFAULT_INTERVAL_MS;
  const shouldCheck = !checkedAt || (Number.isFinite(checkInterval) && now - checkedAt > checkInterval);
  if (!shouldCheck) return;

  const entry = resolveUpdateCheckEntrypoint(params.cliRootDir);
  const spawnImpl = params.spawnDetached ?? spawnDetachedNode;
  const lockTtlMs = envNumber(env, 'PIGGERCODE_CLI_UPDATE_CHECK_LOCK_TTL_MS') ?? DEFAULT_CHECK_LOCK_TTL_MS;
  const lockPath = resolveCliUpdateCheckLockPath({ homeDir: params.homeDir, publicReleaseRing: params.publicReleaseRing });
  if (!acquireSingleFlightLock({ lockPath, nowMs: now, ttlMs: lockTtlMs, pid: process.pid })) return;
  let started = false;
  try {
    const spawned = spawnImpl({
      script: entry,
      args: ['self', 'check', '--quiet', ...resolveSelfChannelArgs(params.publicReleaseRing)],
      cwd: params.cliRootDir,
      // The check gives the lock back when it ends (`releaseSpawnedCliUpdateCheckLock`); the TTL only
      // covers a check that never ends.
      env: { ...env, PIGGERCODE_CLI_UPDATE_CHECK_SPAWNED: '1', [SPAWNED_CHECK_LOCK_ENV_KEY]: String(now) },
    });
    started = spawned?.started !== false;
  } catch {
    // Best-effort: update checks must never crash the CLI.
  }
  // Nothing started (the spawn reported it, or threw), so nothing will give the lock back.
  if (!started) releaseSingleFlightLock({ lockPath, acquiredAtMs: now });
}

/**
 * The end of a `self check` this module spawned: it gives back the single-flight lock it was started
 * under, so the next check — "check for updates" right after a check that failed offline — is not
 * held back for the rest of the lock's TTL. A check started any other way holds no lock.
 */
export function releaseSpawnedCliUpdateCheckLock(params: Readonly<{
  homeDir: string;
  publicReleaseRing: PublicReleaseRingId;
  env: NodeJS.ProcessEnv;
}>): void {
  const acquiredAtMs = Number(params.env[SPAWNED_CHECK_LOCK_ENV_KEY] ?? '');
  if (!Number.isFinite(acquiredAtMs) || acquiredAtMs <= 0) return;
  releaseSingleFlightLock({
    lockPath: resolveCliUpdateCheckLockPath({ homeDir: params.homeDir, publicReleaseRing: params.publicReleaseRing }),
    acquiredAtMs,
  });
}

export function maybeAutoUpdateNotice(params: Readonly<{
  argv: string[];
  isTTY: boolean;
  homeDir: string;
  cliRootDir: string;
  env: NodeJS.ProcessEnv;
  publicReleaseRing?: PublicReleaseRingId;
  nowMs?: number;
  notifyIntervalMs?: number;
  checkIntervalMs?: number;
  spawnDetached?: (args: { script: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }) => DetachedSpawnResult | void;
}>): void {
  const env = params.env;
  if (!updateChecksEnabled(env)) return;
  if (!params.isTTY) return;
  // A runner the daemon started owns no human's terminal: its pane belongs to the agent (a 「终端」
  // session shows native Claude Code there), and the daemon keeps its own update facts.
  if (readStartedByArg(params.argv).value === 'daemon') return;
  if (String(env.PIGGERCODE_CLI_UPDATE_CHECK_SPAWNED ?? '').trim() === '1') return;
  if (isVersionInvocation(params.argv)) return;

  const cmd = getCmdFromArgv(params.argv);
  const now = params.nowMs ?? Date.now();
  const publicReleaseRing = params.publicReleaseRing ?? 'stable';

  const cachePath = resolveCliUpdateCachePath({ homeDir: params.homeDir, publicReleaseRing });
  const cached = readUpdateCache(cachePath);
  const checkedAt = typeof cached?.checkedAt === 'number' ? cached.checkedAt : 0;

  const checkInterval =
    params.checkIntervalMs ??
    envNumber(env, 'PIGGERCODE_CLI_UPDATE_CHECK_INTERVAL_MS') ??
    DEFAULT_INTERVAL_MS;
  const notifyInterval =
    params.notifyIntervalMs ??
    envNumber(env, 'PIGGERCODE_CLI_UPDATE_NOTIFY_INTERVAL_MS') ??
    DEFAULT_INTERVAL_MS;

  const shouldCheck = !checkedAt || (Number.isFinite(checkInterval) && now - checkedAt > checkInterval);

  const cachedLatest = typeof cached?.latest === 'string' ? cached.latest : null;
  // Cross-channel cache entries can exist if the cache was populated before
  // the `self check` filter was added. Suppress the notice; it'll self-heal.
  const latestMatchesRing = doesVersionMatchReleaseRing(cachedLatest, publicReleaseRing);
  const latest = latestMatchesRing ? cachedLatest : null;
  const current = typeof cached?.current === 'string' ? cached.current : null;
  const effectiveCurrent = current
    ?? (typeof cached?.runtimeVersion === 'string' ? cached.runtimeVersion : null)
    ?? (typeof cached?.invokerVersion === 'string' ? cached.invokerVersion : null);
  const candidateIsNewer = !latest || !effectiveCurrent || compareVersions(latest, effectiveCurrent) > 0;
  const updateAvailable = Boolean(cached?.updateAvailable) && latestMatchesRing && candidateIsNewer;
  const notifiedAt = typeof cached?.notifiedAt === 'number' ? cached.notifiedAt : null;

  const shouldNotify = shouldNotifyUpdate({
    isTTY: params.isTTY,
    cmd,
    updateAvailable,
    latest,
    notifiedAt,
    notifyIntervalMs: notifyInterval,
    nowMs: now,
  });

  if (shouldNotify && cached) {
    const from = current || cached.runtimeVersion || cached.invokerVersion || 'current';
    const msg = formatUpdateNotice({
      toolName: resolveManagedCliToolNameForRing(publicReleaseRing),
      from,
      to: latest ?? 'latest',
      updateCommand: resolveUpdateCommand(publicReleaseRing),
    });
    console.error(msg);
    writeUpdateCache(cachePath, { ...cached, notifiedAt: now });
  }

  if (!shouldCheck) return;

  maybeRefreshCliUpdateCacheInBackground({
    homeDir: params.homeDir,
    cliRootDir: params.cliRootDir,
    env,
    publicReleaseRing,
    nowMs: now,
    checkIntervalMs: checkInterval,
    spawnDetached: params.spawnDetached,
  });
}
