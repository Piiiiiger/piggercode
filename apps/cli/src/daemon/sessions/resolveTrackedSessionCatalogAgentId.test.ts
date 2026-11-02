import { describe, expect, it } from 'vitest';

import type { Metadata } from '@/api/types';
import type { TrackedSession } from '../types';
import { resolveTrackedSessionCatalogAgentId } from './resolveTrackedSessionCatalogAgentId';

function trackedSession(overrides: Partial<TrackedSession>): TrackedSession {
  return {
    startedBy: 'daemon',
    pid: 123,
    ...overrides,
  };
}

function metadata(overrides: Partial<Metadata>): Metadata {
  return {
    path: '/repo',
    host: 'test',
    homeDir: '/home/test',
    happyHomeDir: '/home/test/.piggercode',
    happyLibDir: '/home/test/.piggercode/lib',
    happyToolsDir: '/home/test/.piggercode/tools',
    ...overrides,
  };
}

describe('resolveTrackedSessionCatalogAgentId', () => {

  it('infers Codex from local webhook metadata when spawn options are not hydrated yet', () => {
    expect(resolveTrackedSessionCatalogAgentId(trackedSession({
      happySessionMetadataFromLocalWebhook: metadata({
        codexSessionId: 'codex-session',
        codexBackendMode: 'appServer',
      }),
    }))).toBe('codex');
  });

});
