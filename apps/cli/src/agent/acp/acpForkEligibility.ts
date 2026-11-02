import { resolvePersistedCodexRuntimeIdentity } from '@piggercode/agents';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readProviderIdFromMetadataEntry(metadata: Record<string, unknown>, key: string): string | null {
  const entry = metadata[key];
  if (!isRecord(entry)) return null;
  const provider = entry.provider;
  return typeof provider === 'string' ? provider : null;
}

export function isAcpForkEligibleForProvider(params: Readonly<{ providerId: string; metadata: unknown }>): boolean {
  const providerId = params.providerId.trim();
  if (!providerId) return false;

  if (!isRecord(params.metadata)) return false;
  const metadata = params.metadata;

  if (providerId === 'codex') {
    const runtimeIdentity = resolvePersistedCodexRuntimeIdentity(metadata);
    if (runtimeIdentity) {
      return runtimeIdentity.backendMode === 'acp';
    }
  }

  return (
    readProviderIdFromMetadataEntry(metadata, 'acpTransportV1') === providerId ||
    readProviderIdFromMetadataEntry(metadata, 'acpSessionModesV1') === providerId ||
    readProviderIdFromMetadataEntry(metadata, 'acpSessionModelsV1') === providerId ||
    readProviderIdFromMetadataEntry(metadata, 'acpConfigOptionsV1') === providerId ||
    readProviderIdFromMetadataEntry(metadata, 'acpHistoryImportV1') === providerId
  );
}
