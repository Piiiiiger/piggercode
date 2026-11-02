/**
 * Shared GitHub release-tag + repo resolution for the Happier relay server.
 * Single source of truth — previously duplicated in `liveRelayRuntime.ts`
 * and `diagnostics/doctorRepair/relayUpdateCheck.ts`.
 *
 * The CLI is distributed via npm (`@piggercode/cli`) and uses the
 * `readNpmDistTagVersion` helper instead of GitHub; this module is
 * relay-specific.
 */

import type { PublicReleaseRingId, PublicReleaseRingLabel } from '@piggercode/release-runtime/releaseRings';
import { getReleaseRingPublicLabel } from '@piggercode/release-runtime/releaseRings';

export type RelayChannelInput = PublicReleaseRingId | PublicReleaseRingLabel | string;

/**
 * Resolve the GitHub release tag for the relay server binary for a given
 * channel. Accepts either a ring id (`publicdev`) or a public label
 * (`dev`/`stable`/`preview`).
 *
 *   stable  → server-stable
 *   preview → server-preview
 *   dev     → server-dev
 */
export function resolveRelayReleaseTag(channel: RelayChannelInput): string {
  const label = normaliseToPublicLabel(channel);
  if (label === 'preview') return 'server-preview';
  if (label === 'dev') return 'server-dev';
  return 'server-stable';
}

/**
 * Resolve the owner/repo slug used for Happier GitHub releases.
 * Honours the `PIGGERCODE_GITHUB_REPO` env var (for forked or internal repos)
 * and falls back to the canonical `Piiiiiger/piggercode`.
 */
export function resolveHappierGithubRepo(): string {
  const raw = String(process.env.PIGGERCODE_GITHUB_REPO ?? '').trim();
  return raw || 'Piiiiiger/piggercode';
}

function normaliseToPublicLabel(channel: RelayChannelInput): PublicReleaseRingLabel {
  const raw = String(channel ?? '').trim().toLowerCase();
  if (raw === 'stable' || raw === 'preview' || raw === 'dev') return raw;
  if (raw === 'publicdev') return 'dev';
  // Fall through: try the catalog in case this is any other ReleaseRingId.
  try {
    return getReleaseRingPublicLabel(raw as PublicReleaseRingId);
  } catch {
    return 'stable';
  }
}
