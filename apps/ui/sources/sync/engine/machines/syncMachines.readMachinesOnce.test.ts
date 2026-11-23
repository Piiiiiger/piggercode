import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/log', () => ({ log: { log: vi.fn() } }));

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function row(id: string, metadata: string) {
    return {
        id, metadata, metadataVersion: 2, daemonState: null, daemonStateVersion: 0, dataEncryptionKey: null,
        seq: 1, active: true, activeAt: 10, revokedAt: null, createdAt: 1, updatedAt: 10,
    };
}

/** Machine encryption as the account's keys open it; `unreadable` machines have no key this client can open. */
function createEncryptionHarness(unreadable: ReadonlySet<string> = new Set()) {
    const initialized = new Set<string>();
    const decryptMetadata = vi.fn(async (_version: number, value: string): Promise<unknown> => ({ host: value, happyCliVersion: value }));
    return {
        decryptEncryptionKeys: vi.fn(async (values: readonly string[]) => values.map(() => new Uint8Array([1, 2, 3]))),
        initializeMachines: vi.fn(async (machineKeys: Map<string, Uint8Array | null>) => {
            for (const machineId of machineKeys.keys()) if (!unreadable.has(machineId)) initialized.add(machineId);
        }),
        decryptMetadata,
        decryptDaemonState: vi.fn(async () => null),
        getMachineEncryption: (machineId: string) => (initialized.has(machineId)
            ? { decryptMetadata, decryptDaemonState: vi.fn(async () => null) }
            : null),
    };
}

afterEach(() => {
    vi.clearAllMocks();
});

beforeEach(() => {
    vi.resetModules();
});

describe('readMachinesOnce', () => {
    it('returns every machine with the metadata this read decrypted', async () => {
        const { readMachinesOnce } = await import('./syncMachines');
        const machines = await readMachinesOnce({
            credentials: { token: 't', secret: 's' },
            encryption: createEncryptionHarness(),
            machineDataKeys: new Map(),
            request: async () => jsonResponse([row('vm', '0.3.42'), row('mac', '0.3.41')]),
        });
        expect(machines.map((machine) => [machine.id, (machine.metadata as { happyCliVersion?: string } | null)?.happyCliVersion]))
            .toEqual([['vm', '0.3.42'], ['mac', '0.3.41']]);
    });

    it('keeps a machine whose metadata it cannot open, without metadata', async () => {
        const { readMachinesOnce } = await import('./syncMachines');
        const machines = await readMachinesOnce({
            credentials: { token: 't', secret: 's' },
            encryption: createEncryptionHarness(new Set(['mac'])),
            machineDataKeys: new Map(),
            request: async () => jsonResponse([row('vm', '0.3.42'), row('mac', '0.3.42')]),
        });
        expect(machines.find((machine) => machine.id === 'mac')).toMatchObject({ metadata: null });
    });

    it('rejects when the list cannot be read or the read is abandoned', async () => {
        const { readMachinesOnce } = await import('./syncMachines');
        await expect(readMachinesOnce({
            credentials: { token: 't', secret: 's' },
            encryption: createEncryptionHarness(),
            machineDataKeys: new Map(),
            request: async () => jsonResponse({ error: 'unavailable' }, 503),
        })).rejects.toThrow();
        await expect(readMachinesOnce({
            credentials: { token: 't', secret: 's' },
            encryption: createEncryptionHarness(),
            machineDataKeys: new Map(),
            request: async () => jsonResponse([row('vm', '0.3.42')]),
            shouldContinue: () => false,
        })).rejects.toThrow();
        // The scope changes while the machines decrypt.
        const switching = createEncryptionHarness();
        let decrypted = false;
        switching.decryptMetadata.mockImplementation(async (_version: number, value: string) => {
            decrypted = true;
            return { host: value, happyCliVersion: value };
        });
        await expect(readMachinesOnce({
            credentials: { token: 't', secret: 's' },
            encryption: switching,
            machineDataKeys: new Map(),
            request: async () => jsonResponse([row('vm', '0.3.42')]),
            shouldContinue: () => !decrypted,
        })).rejects.toThrow();
    });
});
