import { compareVersions } from '@piggercode/cli-common/update';
import { CONNECTED_SERVICES_MANAGEMENT_MIN_CLI_VERSION } from '@piggercode/protocol';

import { getAccountEncryptionMode } from '@/api/connectedServices/connectedServiceCredentialApi';
import { fetchAccountMachines } from '@/api/machine/fetchAccountMachines';
import { decodeMachineStoredContent } from '@/api/machine/machineStoredContent';
import { resolvePublishedMachineContent } from '@/api/machine/resolveMachineRegistrationContent';
import type { Credentials } from '@/persistence';

const ORDERABLE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+.*)?$/;

export type OutdatedAccountMachine = Readonly<{
  machineId: string;
  host: string | null;
  cliVersion: string | null;
}>;

function readMetadataField(metadata: unknown, field: 'happyCliVersion' | 'host'): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Readonly<Record<string, unknown>>)[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Known machines (online or not) whose CLI predates single-machine management: such a daemon would
 * still refresh and read subscription logins. A machine whose version cannot be read counts as
 * outdated; retired or replaced machines never act again and do not count.
 */
export async function readOutdatedAccountMachines(params: Readonly<{
  credentials: Credentials;
  timeoutMs?: number;
}>): Promise<ReadonlyArray<OutdatedAccountMachine>> {
  const rows = await fetchAccountMachines({
    credentials: params.credentials,
    ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
  });
  if (!rows) throw new Error('The account machine inventory could not be read');
  const accountMode = await getAccountEncryptionMode({
    token: params.credentials.token,
    ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
  });
  const outdated: OutdatedAccountMachine[] = [];
  for (const row of rows) {
    if (row.revokedAt || row.replacedByMachineId) continue;
    let metadata: unknown = null;
    try {
      const content = resolvePublishedMachineContent(params.credentials, row.dataEncryptionKey, accountMode);
      metadata = row.metadata ? decodeMachineStoredContent(content.context, row.metadata) : null;
    } catch {
      metadata = null;
    }
    const cliVersion = readMetadataField(metadata, 'happyCliVersion');
    // `compareVersions` orders unparseable text lexically ("unknown" > "0.3.42"): only a
    // version it can order proves the machine honours the management setting.
    if (cliVersion && ORDERABLE_VERSION.test(cliVersion)
      && compareVersions(cliVersion, CONNECTED_SERVICES_MANAGEMENT_MIN_CLI_VERSION) >= 0) continue;
    outdated.push({ machineId: row.id, host: readMetadataField(metadata, 'host'), cliVersion });
  }
  return outdated;
}
