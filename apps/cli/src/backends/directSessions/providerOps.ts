import type {
  DirectSessionCandidateV1,
  DirectSessionsSource,
  DirectTranscriptRawMessageV1,
  DirectTranscriptTruncationReason,
} from '@piggercode/protocol';

import type {
  DirectSessionFollowLease,
  DirectSessionFollowLeaseReason,
} from '@/api/directSessions/backgroundFollow/createManagedDirectSessionFollowLease';
import type { LoadedLinkedDirectSession } from '@/api/directSessions/takeover/loadLinkedDirectSession';
import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';

export type DirectSessionCandidatesPage = Readonly<{
  candidates: DirectSessionCandidateV1[];
  nextCursor: string | null;
  searchIncomplete?: boolean;
  capabilities?: Readonly<{
    deleteCandidate: boolean;
  }>;
}>;

export type DirectSessionActivitySample = Readonly<{
  lastActivityAtMs: number | null;
  isRunning: boolean;
}>;

export type DirectSessionTranscriptPage = Readonly<{
  items: DirectTranscriptRawMessageV1[];
  nextCursor: string | null;
  tailCursor: string | null;
  hasMore: boolean;
  truncated: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
}>;

export type DirectSessionTranscriptReadAfter = Readonly<{
  items: DirectTranscriptRawMessageV1[];
  nextCursor: string | null;
  truncated: boolean;
  truncationReason?: DirectTranscriptTruncationReason;
}>;

/**
 * A direct-sessions operation the resolved provider genuinely cannot perform for this source.
 * Callers map it to `provider_unavailable` so the surface degrades truthfully instead of reporting
 * an internal error or an empty-but-successful result.
 */
export class DirectSessionsProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectSessionsProviderUnavailableError';
  }
}

/**
 * The provider keeps no copy that could be moved aside or brought back (it has no trash operation at all), as
 * opposed to a provider that has copies but cannot move one right now. Only this answer lets a session go to
 * (or come back from) the trash without its machine.
 */
export class DirectSessionsProviderUnsupportedError extends DirectSessionsProviderUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'DirectSessionsProviderUnsupportedError';
  }
}

/**
 * Transcript, activity and takeover members are optional: a resume-only source (ACP `session/list`)
 * can enumerate candidates without owning the provider's transcript store or process lifecycle.
 */
export type DirectSessionProviderOps = Readonly<{
  listCandidates: (params: Readonly<{
    source: DirectSessionsSource;
    cursor?: string;
    limit: number;
    searchTerm?: string;
    searchMode?: 'fast' | 'full';
  }>) => Promise<DirectSessionCandidatesPage>;
  deleteCandidate?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<void>;
  /** The provider's name for the store a source points at (a Codex home), so equal remote ids in different stores stay distinct. */
  resolveCopyIdentity?: (params: Readonly<{ source: DirectSessionsSource }>) => Promise<string>;
  /** Moves the provider's copy aside (it stays recoverable) when its session goes to the trash. */
  trashCandidate?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<void>;
  /** Puts a trashed provider copy back. */
  restoreCandidate?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<void>;
  getActivity?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
  }>) => Promise<DirectSessionActivitySample>;
  pageTranscript?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
    direction: 'older' | 'newer';
    cursor?: string;
    maxBytes: number;
    maxItems: number;
  }>) => Promise<DirectSessionTranscriptPage>;
  readAfterTranscript?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
    cursor: string;
    maxBytes: number;
    maxItems: number;
  }>) => Promise<DirectSessionTranscriptReadAfter>;
  acquireFollowLease?: (params: Readonly<{
    source: DirectSessionsSource;
    remoteSessionId: string;
    reason: DirectSessionFollowLeaseReason;
  }>) => Promise<DirectSessionFollowLease | null>;
  resolveTakeoverSpawnOptions?: (params: Readonly<{
    linked: LoadedLinkedDirectSession;
    sessionId: string;
    transcriptStorage: 'direct' | 'persisted';
  }>) => Promise<SpawnSessionOptions | null>;
}>;

export function mergeDirectSessionEnvironmentVariables(values: Array<Record<string, string> | null>): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  for (const value of values) {
    if (!value) continue;
    for (const [key, raw] of Object.entries(value)) {
      const normalized = String(raw ?? '').trim();
      if (!normalized) continue;
      merged[key] = normalized;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
