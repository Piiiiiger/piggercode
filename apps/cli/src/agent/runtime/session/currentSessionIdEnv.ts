import { readNonBlankOpaqueIdentifier } from '@/utils/opaqueIdentifiers';

export const PIGGERCODE_SESSION_ID_ENV_KEY = 'PIGGERCODE_SESSION_ID' as const;

/** Returns a usable non-blank managed session id, excluding local `offline-*` placeholders. */
export function normalizeCurrentHappierSessionId(value: unknown): string | null {
  const sessionId = readNonBlankOpaqueIdentifier(value);
  return sessionId && !sessionId.startsWith('offline-') ? sessionId : null;
}

/** Reads the ambient managed session id from an environment after canonical normalization. */
export function readCurrentHappierSessionIdFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return normalizeCurrentHappierSessionId(env[PIGGERCODE_SESSION_ID_ENV_KEY]);
}

/** Returns a copied environment with the managed session id set, or removed when unusable. */
export function withCurrentHappierSessionId(
  env: Record<string, string>,
  sessionId: unknown,
): Record<string, string>;
export function withCurrentHappierSessionId(
  env: NodeJS.ProcessEnv,
  sessionId: unknown,
): NodeJS.ProcessEnv;
export function withCurrentHappierSessionId(
  env: NodeJS.ProcessEnv,
  sessionId: unknown,
): NodeJS.ProcessEnv {
  const resolvedSessionId = normalizeCurrentHappierSessionId(sessionId);
  const nextEnv: NodeJS.ProcessEnv = { ...env };
  if (resolvedSessionId) {
    nextEnv[PIGGERCODE_SESSION_ID_ENV_KEY] = resolvedSessionId;
  } else {
    delete nextEnv[PIGGERCODE_SESSION_ID_ENV_KEY];
  }
  return nextEnv;
}
