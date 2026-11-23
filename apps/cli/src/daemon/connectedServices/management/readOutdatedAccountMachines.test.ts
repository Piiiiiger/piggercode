import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeMachineStoredContent } from '@/api/machine/machineStoredContent';
import { resolvePublishedMachineContent } from '@/api/machine/resolveMachineRegistrationContent';
import type { Credentials } from '@/persistence';
import { readOutdatedAccountMachines } from './readOutdatedAccountMachines';

// The relay's HTTP API is the boundary: the machine inventory and the account's encryption mode.
vi.mock('axios');

const credentials = { token: 'happy-token', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(5) } } satisfies Credentials;

function machineMetadata(metadata: Readonly<Record<string, unknown>>): string {
  // Machines without a published data key store their metadata under the account's own key.
  return encodeMachineStoredContent(resolvePublishedMachineContent(credentials, undefined, 'e2ee').context, metadata);
}

function serveRelay(machines: unknown): void {
  vi.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url.endsWith('/v1/machines')) {
      if (machines instanceof Error) throw machines;
      return { status: 200, data: machines };
    }
    if (url.endsWith('/v1/account/encryption')) return { status: 404, data: null };
    throw new Error(`unexpected request ${url}`);
  });
}

afterEach(() => {
  vi.mocked(axios.get).mockReset();
});

describe('readOutdatedAccountMachines', () => {
  it('lists every live machine whose CLI predates single-machine management, unreadable ones included', async () => {
    serveRelay([
      { id: 'vm', metadata: machineMetadata({ host: 'vm', happyCliVersion: '0.3.42' }) },
      { id: 'mac', metadata: machineMetadata({ host: 'old-mac', happyCliVersion: '0.3.41' }) },
      { id: 'unreadable', metadata: 'not-machine-content' },
      { id: 'asleep', metadata: machineMetadata({ host: 'asleep', happyCliVersion: 'unknown' }) },
      { id: 'retired', revokedAt: 5, metadata: machineMetadata({ host: 'retired', happyCliVersion: '0.1.0' }) },
      { id: 'replaced', replacedByMachineId: 'vm', metadata: machineMetadata({ host: 'replaced', happyCliVersion: '0.1.0' }) },
    ]);

    await expect(readOutdatedAccountMachines({ credentials })).resolves.toEqual([
      { machineId: 'mac', host: 'old-mac', cliVersion: '0.3.41' },
      // A version that cannot be read or ordered could belong to any CLI: it blocks launches like an old one.
      { machineId: 'unreadable', host: null, cliVersion: null },
      { machineId: 'asleep', host: 'asleep', cliVersion: 'unknown' },
    ]);
  });

  it('fails rather than reporting no outdated machines when the inventory cannot be read', async () => {
    serveRelay(new Error('relay unreachable'));

    await expect(readOutdatedAccountMachines({ credentials })).rejects.toThrow('could not be read');
  });
});
