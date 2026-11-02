import { z } from 'zod';

const EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS = 'EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS';

// Legacy Kokoro-only env keys (supported temporarily for backward compatibility).
const EXPO_PUBLIC_KOKORO_NATIVE_MANIFEST_URL = 'EXPO_PUBLIC_KOKORO_NATIVE_MANIFEST_URL';
const EXPO_PUBLIC_KOKORO_NATIVE_MANIFESTS = 'EXPO_PUBLIC_KOKORO_NATIVE_MANIFESTS';

// IMPORTANT: Expo only inlines EXPO_PUBLIC_* variables when accessed via dot notation.
// Avoid dynamic process.env[key] reads in production code paths. They are read on each call, so a
// build's values (inlined) and a test's stubbed environment both apply.
function readBuildEnv(): Record<string, string | undefined> {
  return {
    [EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS]: process.env.EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS,
    [EXPO_PUBLIC_KOKORO_NATIVE_MANIFESTS]: process.env.EXPO_PUBLIC_KOKORO_NATIVE_MANIFESTS,
    [EXPO_PUBLIC_KOKORO_NATIVE_MANIFEST_URL]: process.env.EXPO_PUBLIC_KOKORO_NATIVE_MANIFEST_URL,
  };
}

const ManifestMapSchema = z.record(z.string().min(1), z.string().url());

function readManifestMap(raw: string | undefined): Record<string, string> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = ManifestMapSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function resolveModelPackManifestUrl(opts: {
  packId: string | null;
  env?: Record<string, string | undefined>;
}): string | null {
  const env = opts.env ?? readBuildEnv();
  const id = opts.packId && opts.packId.trim().length > 0 ? opts.packId.trim() : 'default';

  const map = readManifestMap(env[EXPO_PUBLIC_HAPPIER_MODEL_PACK_MANIFESTS]);
  const fromMap = map?.[id];
  if (typeof fromMap === 'string' && fromMap.trim().length > 0) return fromMap.trim();

  const legacyMap = readManifestMap(env[EXPO_PUBLIC_KOKORO_NATIVE_MANIFESTS]);
  const fromLegacyMap = legacyMap?.[id];
  if (typeof fromLegacyMap === 'string' && fromLegacyMap.trim().length > 0) return fromLegacyMap.trim();

  const fromLegacyDefault = env[EXPO_PUBLIC_KOKORO_NATIVE_MANIFEST_URL];
  if (typeof fromLegacyDefault === 'string' && fromLegacyDefault.trim().length > 0) return fromLegacyDefault.trim();

  // No default: PiggerCode does not download model packs from upstream's asset releases. A build that
  // wants local neural voice names its manifests through the env keys above.
  return null;
}
