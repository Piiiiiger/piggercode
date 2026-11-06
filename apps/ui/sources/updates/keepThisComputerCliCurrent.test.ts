import { SYSTEM_TASK_PROTOCOL_VERSION } from '@piggercode/protocol';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { inspectionFromResult } from '@/setup/desktopSetupCoordinator';

import type { UpdateItem } from './items/updateItem';
import { canKeepThisComputerCliCurrent, useKeepThisComputerCliCurrent } from './keepThisComputerCliCurrent';

const APP_RELAY = 'https://relay.example.com';
const APP = { relayUrl: APP_RELAY, localRelayUrl: null, accountId: 'acct_app' } as const;

/** This computer's default service as the executor reports it (bootstrap status). */
function facts(params: Readonly<{ relayUrl?: string; accountId?: string; provenance?: 'managed' | 'override' }> = {}) {
    const relayUrl = params.relayUrl ?? APP_RELAY;
    const accountId = params.accountId ?? 'acct_app';
    return {
        acquisition: { command: '/home/me/.piggercode/bin/piggercode', provenance: params.provenance ?? 'managed' },
        server: { serverUrl: relayUrl, publicServerUrl: relayUrl, localServerUrl: null, comparableKey: null },
        auth: { credentialState: 'valid', validatedAccountId: accountId, accountId, machineId: 'machine-1' },
        service: { installed: true, running: true, autostart: 'at-login', targetMode: 'default-following' },
        runtimeConvergence: { controlReachable: true, serviceOwnsRunningDaemon: true, machineIdMatches: true, cliVersionMatches: true },
        cli: { update: null, choice: null },
    };
}

const APP_ROW = { relayUrl: APP_RELAY, state: 'connected', appManaged: true, serving: 'default-following', actions: ['restart', 'stop'] };

/** A status result as the executor sends it (rows and the completeness signal included). */
function inspection(params: Readonly<{ facts?: ReturnType<typeof facts>; rows?: readonly unknown[]; complete?: boolean | null }> = {}) {
    const complete = params.complete === undefined ? true : params.complete;
    return inspectionFromResult({
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        taskId: 'task_status',
        ok: true,
        data: {
            ...(params.facts ?? facts()),
            serviceRows: params.rows ?? [APP_ROW],
            ...(complete === null ? {} : { pinnedServices: { complete, coexistence: true, services: [], unreadable: [] } }),
        } as never,
    });
}

describe('when the desktop app may update this computer\'s command line by itself', () => {
    it('does for its own CLI and only service, connected for the account it is on', () => {
        expect(canKeepThisComputerCliCurrent(inspection(), APP)).toBe(true);
    });

    it('does not while another service here was set up by the person (the update would restart it too)', () => {
        const rows = [APP_ROW, { relayUrl: 'https://mine.example.com', state: 'connected', appManaged: false, serving: 'pinned', actions: [] }];
        expect(canKeepThisComputerCliCurrent(inspection({ rows }), APP)).toBe(false);
    });

    it('does not while the executor could not list every service here', () => {
        expect(canKeepThisComputerCliCurrent(inspection({ complete: false }), APP)).toBe(false);
        expect(canKeepThisComputerCliCurrent(inspection({ complete: null }), APP)).toBe(false);
    });

    it('does not mid-switch: the service is signed in as another account, or serves another relay', () => {
        expect(canKeepThisComputerCliCurrent(inspection({ facts: facts({ accountId: 'acct_other' }) }), APP)).toBe(false);
        const elsewhere = 'https://other.example.com';
        expect(canKeepThisComputerCliCurrent(inspection({
            facts: facts({ relayUrl: elsewhere }),
            rows: [{ ...APP_ROW, relayUrl: elsewhere }],
        }), APP)).toBe(false);
        expect(canKeepThisComputerCliCurrent(inspection(), { ...APP, accountId: null })).toBe(false);
    });

    it('does not for a CLI the app did not install', () => {
        expect(canKeepThisComputerCliCurrent(inspection({ facts: facts({ provenance: 'override' }) }), APP)).toBe(false);
    });
});

function thisComputerRow(state: 'available' | 'upToDate', latestVersion: string): UpdateItem {
    return {
        id: 'mac:happier-cli', subject: { kind: 'happier-cli' }, machineId: 'mac', title: 'PiggerCode CLI',
        currentVersion: '0.3.3', latestVersion, state, progressPercent: null, step: null, managedBy: 'happier',
        action: state === 'available' ? { kind: 'run', verb: 'update' } : { kind: 'none' }, failure: null, skipped: false,
    } as UpdateItem;
}

type KeepProps = Readonly<{ item: UpdateItem | null; allowed?: boolean; canUpdate?: boolean }>;

async function renderKeeper(initialProps: KeepProps) {
    const check = vi.fn(async () => {});
    const updates = vi.fn();
    const hook = await renderHook(
        (props: KeepProps) => useKeepThisComputerCliCurrent({
            enabled: true,
            allowed: props.allowed ?? true,
            item: props.item,
            canUpdate: props.canUpdate ?? true,
            check,
            // A new function on each render, as the row's own `run` is whenever its item changes.
            update: async () => { updates(); },
        }),
        { initialProps },
    );
    return { hook, check, updates };
}

describe('the desktop app keeps this computer\'s command line current', () => {
    it('looks for a newer command line once when the app opens', async () => {
        const { hook, check } = await renderKeeper({ item: thisComputerRow('upToDate', '0.3.3') });
        await hook.rerender({ item: thisComputerRow('upToDate', '0.3.3') });

        expect(check).toHaveBeenCalledTimes(1);
    });

    it('installs a newer command line by itself, once per version', async () => {
        const { hook, updates } = await renderKeeper({ item: thisComputerRow('upToDate', '0.3.3') });
        expect(updates).not.toHaveBeenCalled();

        await hook.rerender({ item: thisComputerRow('available', '0.3.5') });
        expect(updates).toHaveBeenCalledTimes(1);

        // Still offered (the update failed, or has not finished): not started again by itself.
        await hook.rerender({ item: thisComputerRow('available', '0.3.5') });
        expect(updates).toHaveBeenCalledTimes(1);

        await hook.rerender({ item: thisComputerRow('available', '0.3.6') });
        expect(updates).toHaveBeenCalledTimes(2);
    });

    it('waits until the update can start, and does nothing where it is not allowed', async () => {
        const { hook, updates } = await renderKeeper({ item: thisComputerRow('available', '0.3.5'), canUpdate: false });
        expect(updates).not.toHaveBeenCalled();
        await hook.rerender({ item: thisComputerRow('available', '0.3.5'), canUpdate: true });
        expect(updates).toHaveBeenCalledTimes(1);

        const notAllowed = await renderKeeper({ item: thisComputerRow('available', '0.3.5'), allowed: false });
        expect(notAllowed.check).not.toHaveBeenCalled();
        expect(notAllowed.updates).not.toHaveBeenCalled();
    });
});
