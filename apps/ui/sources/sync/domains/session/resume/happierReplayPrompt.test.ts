import { describe, expect, it } from 'vitest';

import {
  PIGGERCODE_REPLAY_RECENT_MESSAGES_MAX_COUNT,
  PIGGERCODE_REPLAY_SEED_MIN_CHARS,
} from '@piggercode/protocol';

import { settingsDefaults } from '@/sync/domains/settings/settings';

import { resolveHappierReplayConfig } from './happierReplayPrompt';

describe('resolveHappierReplayConfig', () => {
  it('returns a bounded recentMessagesCount and maxSeedChars budget', () => {
    const cfg = resolveHappierReplayConfig({
      ...settingsDefaults,
      sessionReplayEnabled: true,
      sessionReplayRecentMessagesCount: 10_000,
      sessionReplayMaxSeedChars: 10,
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.recentMessagesCount).toBe(PIGGERCODE_REPLAY_RECENT_MESSAGES_MAX_COUNT);
    expect(cfg.maxSeedChars).toBe(PIGGERCODE_REPLAY_SEED_MIN_CHARS);
  });

  // The forwarding half of the defect: a stored budget the old clamp passed
  // through verbatim reached the wire and produced no seed at all. The clamp is
  // the last writer before the request, so it must lift, never forward.
  it('lifts a stored budget below the floor instead of forwarding it', () => {
    for (const stored of [1, 200, 500, PIGGERCODE_REPLAY_SEED_MIN_CHARS - 1]) {
      expect(resolveHappierReplayConfig({
        ...settingsDefaults,
        sessionReplayEnabled: true,
        sessionReplayMaxSeedChars: stored,
      }).maxSeedChars).toBe(PIGGERCODE_REPLAY_SEED_MIN_CHARS);
    }
  });

  it('passes the floor itself through unchanged', () => {
    expect(resolveHappierReplayConfig({
      ...settingsDefaults,
      sessionReplayEnabled: true,
      sessionReplayMaxSeedChars: PIGGERCODE_REPLAY_SEED_MIN_CHARS,
    }).maxSeedChars).toBe(PIGGERCODE_REPLAY_SEED_MIN_CHARS);
  });
});

