import type { CliUpdateFacts } from '@piggercode/protocol';
import { watchLastCliUpdateResult } from '@piggercode/cli-common/firstPartyRuntime';
import { watchCliUpdateCheckCache } from '@piggercode/cli-common/update';
import type { PublicReleaseRingId } from '@piggercode/release-runtime/releaseRings';

import type { MachineMetadata } from '@/api/types';

import { refreshMachineMetadataForCurrentDaemon } from './metadata';

export type CliUpdateMetadataPublisher = Readonly<{
  /** Refresh the daemon-owned metadata, K5 included. Every (re)connect calls it. */
  publish: () => Promise<void>;
  /** Republish whenever this ring's `last-update.json` or its version-check cache changes. */
  watch: (params: Readonly<{ channel: PublicReleaseRingId; homeDir: string; processEnv?: NodeJS.ProcessEnv }>) => void;
  stop: () => void;
}>;

/**
 * The daemon's one path for publishing its daemon-owned machine metadata (plan R13 K5): on every
 * (re)connect, when an update attempt records its end — which is how a remote update that failed
 * without restarting this daemon (download, verification, smoke) becomes visible — and when a
 * version check rewrites its cache, so the latest version the app compares against is the one this
 * machine last looked up, not the one it knew when it connected.
 *
 * Both watches are on DIRECTORIES (the install root, the cache folder), so a writer's atomic
 * rename-replace never ends them. A watch event can still be missed on some platforms, or a watch
 * can end with its directory; the connect publish is the fallback that always carries both.
 *
 * Publishes are coalesced: while one is in flight, any number of further requests collapse into one
 * trailing publish that reads the facts then current — run even when the in-flight one failed — and
 * an event whose facts equal the last ones published publishes nothing (one write can raise several
 * events). A (re)connect request always publishes.
 */
export function createCliUpdateMetadataPublisher(params: Readonly<{
  updateMachineMetadata: (handler: (metadata: MachineMetadata | null) => MachineMetadata) => Promise<void>;
  fallbackMetadata: () => Partial<MachineMetadata>;
  preferredHost: string;
  readFacts: () => CliUpdateFacts;
  onError: (message: string, error: unknown) => void;
  /** The record watch (`watchLastCliUpdateResult` — a directory watch — unless replaced). */
  watchRecord?: typeof watchLastCliUpdateResult;
  /** The version-check cache watch (`watchCliUpdateCheckCache` — a directory watch — unless replaced). */
  watchCheckCache?: typeof watchCliUpdateCheckCache;
}>): CliUpdateMetadataPublisher {
  let inFlight: Promise<void> | null = null;
  let pending = false;
  let lastPublishedFacts: string | null = null;
  let stopWatching: Array<() => void> = [];

  const publishOnce = async (onlyIfFactsChanged: boolean): Promise<void> => {
    const facts = params.readFacts();
    const serialized = JSON.stringify(facts);
    if (onlyIfFactsChanged && serialized === lastPublishedFacts) return;
    await params.updateMachineMetadata((metadata) => {
      const base = (metadata ?? params.fallbackMetadata()) as Partial<MachineMetadata>;
      return refreshMachineMetadataForCurrentDaemon(base, params.preferredHost, facts);
    });
    lastPublishedFacts = serialized;
  };

  let pendingForced = false;
  const publishCoalesced = (onlyIfFactsChanged: boolean): Promise<void> => {
    if (inFlight) {
      pending = true;
      pendingForced ||= !onlyIfFactsChanged;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        let onlyIfChanged = onlyIfFactsChanged;
        for (;;) {
          pending = false;
          pendingForced = false;
          try {
            await publishOnce(onlyIfChanged);
          } catch (error) {
            // A request that arrived meanwhile still runs; only the last attempt's failure is returned.
            if (!pending) throw error;
            params.onError('[DAEMON RUN] Failed to publish machine metadata; retrying the queued publish', error);
          }
          if (!pending) return;
          onlyIfChanged = !pendingForced;
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const stopAll = (): void => {
    for (const stop of stopWatching) stop();
    stopWatching = [];
  };

  return {
    publish: async () => await publishCoalesced(false),
    watch: (watchParams) => {
      stopAll();
      const republish = () => {
        publishCoalesced(true).catch((error: unknown) => params.onError('[DAEMON RUN] Failed to republish CLI update facts', error));
      };
      const stopRecordWatch = (params.watchRecord ?? watchLastCliUpdateResult)({
        channel: watchParams.channel,
        processEnv: watchParams.processEnv,
        onChange: republish,
        onError: (error) => {
          params.onError('[DAEMON RUN] Stopped watching the CLI update record; the next connect republishes it', error);
        },
      });
      if (stopRecordWatch) stopWatching.push(stopRecordWatch);
      try {
        stopWatching.push((params.watchCheckCache ?? watchCliUpdateCheckCache)({
          homeDir: watchParams.homeDir,
          publicReleaseRing: watchParams.channel,
          onChange: republish,
          onError: (error) => {
            params.onError('[DAEMON RUN] Stopped watching the CLI version check; the next connect republishes it', error);
          },
        }));
      } catch (error) {
        params.onError('[DAEMON RUN] Could not watch the CLI version check; the next connect republishes it', error);
      }
    },
    stop: stopAll,
  };
}
