import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { useSelectedPetPackage } from '@/components/pets/source/useSelectedPetPackage';
import { renderHook, standardCleanup } from '@/dev/testkit';
import { localSettingsDefaults } from '@/sync/domains/settings/localSettings';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import {
    loadLocalPetSourcesBySourceKey,
    loadLocalSettings,
    saveLocalPetSourcesBySourceKey,
    saveLocalSettings,
} from '@/sync/domains/state/persistence';
import { storage } from '@/sync/domains/state/storageStore';

import { DESKTOP_LOCAL_STATE_CHANGED_EVENT, startDesktopLocalStateSync } from './desktopLocalStateSync';

// The Tauri event bus between the app's webviews (main window, pet overlay) is the system boundary here.
const tauriEvents = vi.hoisted(() => ({
    handlers: [] as Array<(payload: unknown) => void>,
    emitted: [] as Array<Readonly<{ event: string; payload: unknown }>>,
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => true,
    invokeTauri: vi.fn(async () => null),
    listenTauriEvent: vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
        tauriEvents.handlers.push(handler);
        return () => {
            tauriEvents.handlers = tauriEvents.handlers.filter((candidate) => candidate !== handler);
        };
    }),
    emitTauriEvent: vi.fn(async (event: string, payload: unknown) => {
        tauriEvents.emitted.push({ event, payload });
    }),
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string) => ({ state: featureId === 'pets.companion' ? 'enabled' : 'disabled' }),
}));

const pigSource = {
    kind: 'happierManagedLocal',
    sourceKey: 'pet:zodiac-pig',
    petId: 'zodiac-pig',
    displayName: 'Zodiac Pig',
    daemonTarget: { machineId: 'machine-mac', serverId: 'server-1' },
} as const;
const pigOverride = { kind: 'happierManagedLocal', sourceKey: pigSource.sourceKey } as const;

function deliverFromAnotherWindow(payload: Readonly<Record<string, unknown>>): void {
    for (const handler of tauriEvents.handlers) handler({ v: 1, senderId: 'other-window', ...payload });
}

/** What this window announced since the last call, without the envelope. */
function takeAnnouncements(): Array<Readonly<Record<string, unknown>>> {
    const announcements = tauriEvents.emitted.map((entry) => {
        expect(entry.event).toBe(DESKTOP_LOCAL_STATE_CHANGED_EVENT);
        return entry.payload as Readonly<Record<string, unknown>>;
    });
    tauriEvents.emitted = [];
    return announcements.map(({ v: _v, senderId: _senderId, ...rest }) => rest);
}

describe('desktop local state sync between the app windows', () => {
    let previousState: ReturnType<typeof storage.getState>;
    let stop: () => void = () => undefined;

    async function startSync(): Promise<void> {
        stop = startDesktopLocalStateSync();
        await vi.waitFor(() => expect(tauriEvents.handlers).toHaveLength(1));
    }

    beforeEach(() => {
        previousState = storage.getState();
        tauriEvents.handlers = [];
        tauriEvents.emitted = [];
        storage.setState((state) => ({
            ...state,
            settings: {
                ...settingsDefaults,
                ...state.settings,
                petsEnabled: true,
                petsSelectedPetRef: { kind: 'builtIn', petId: 'oli' },
            },
            localSettings: {
                ...localSettingsDefaults,
                petsEnabledOverride: 'inherit',
                petsSelectedPetOverride: { kind: 'inherit' },
                petsCompanionSizeScale: 1,
            },
            localPetSourcesBySourceKey: {},
        }));
    });

    afterEach(() => {
        stop();
        storage.setState(previousState, true);
        standardCleanup();
    });

    it('shows the pet another window chose for this device, and keeps it through this window\'s next save', async () => {
        await startSync();
        const hook = await renderHook(() => useSelectedPetPackage(), { flushOptions: { cycles: 1, turns: 4 } });
        expect(hook.getCurrent().source).toEqual({ kind: 'builtIn', petId: 'oli' });
        takeAnnouncements();

        await act(async () => {
            deliverFromAnotherWindow({
                localSettings: { petsSelectedPetOverride: pigOverride },
                localPetSources: { [pigSource.sourceKey]: pigSource },
            });
        });

        expect(hook.getCurrent().source).toMatchObject(pigOverride);
        expect(takeAnnouncements()).toEqual([]);

        // Dismissing a bubble in the overlay saves this window's copy, which now holds the pig: the cat cannot come back.
        act(() => {
            storage.getState().applyLocalSettings({ petsDismissedCompanionTrayItemKeys: ['review:session-1:3000'] });
        });
        expect(takeAnnouncements()).toEqual([{ localSettings: { petsDismissedCompanionTrayItemKeys: ['review:session-1:3000'] } }]);
        expect(loadLocalSettings()).toMatchObject({
            petsSelectedPetOverride: pigOverride,
            petsDismissedCompanionTrayItemKeys: ['review:session-1:3000'],
        });
        await hook.unmount();
    });

    it('announces only what this window changed, and ignores its own announcement', async () => {
        await startSync();
        takeAnnouncements();

        act(() => {
            storage.getState().applyLocalSettings({ petsCompanionSizeScale: 1.5 });
            // A slider move that lands on the same value is no change.
            storage.getState().applyLocalSettings({ petsCompanionSizeScale: 1.5 });
            storage.getState().upsertLocalPetSource(pigSource);
            storage.getState().removeLocalPetSource(pigSource.sourceKey);
        });

        expect(takeAnnouncements()).toEqual([
            { localSettings: { petsCompanionSizeScale: 1.5 } },
            { localPetSources: { [pigSource.sourceKey]: pigSource } },
            { localPetSources: { [pigSource.sourceKey]: null } },
        ]);

        act(() => storage.getState().applyLocalSettings({ petsCompanionSizeScale: 1.25 }));
        const ownSenderId = (tauriEvents.emitted[0]?.payload as { senderId: string }).senderId;
        act(() => {
            for (const handler of tauriEvents.handlers) {
                handler({ v: 1, senderId: ownSenderId, localSettings: { petsCompanionSizeScale: 2 } });
            }
        });
        expect(storage.getState().localSettings.petsCompanionSizeScale).toBe(1.25);
    });

    it('keeps both of two edits to different settings made at nearly the same moment in two windows', async () => {
        await startSync();
        takeAnnouncements();

        // This window writes first, the other window's change arrives after.
        act(() => {
            storage.getState().applyLocalSettings({ petsDismissedCompanionTrayItemKeys: ['review:session-1:3000'] });
            deliverFromAnotherWindow({ localSettings: { petsSelectedPetOverride: pigOverride } });
        });
        // The other window's change arrives first, this window writes after.
        act(() => {
            deliverFromAnotherWindow({ localSettings: { petsCompanionSizeScale: 1.25 } });
            storage.getState().applyLocalSettings({ petsEnabledOverride: 'enabled' });
        });

        const expected = {
            petsDismissedCompanionTrayItemKeys: ['review:session-1:3000'],
            petsSelectedPetOverride: pigOverride,
            petsCompanionSizeScale: 1.25,
            petsEnabledOverride: 'enabled',
        };
        expect(storage.getState().localSettings).toMatchObject(expected);
        // This window's last save happened after it took both of the other window's changes.
        expect(loadLocalSettings()).toMatchObject(expected);
        // Only this window's own two edits went out.
        expect(takeAnnouncements()).toEqual([
            { localSettings: { petsDismissedCompanionTrayItemKeys: ['review:session-1:3000'] } },
            { localSettings: { petsEnabledOverride: 'enabled' } },
        ]);
    });

    it('does not write over a change it missed when it takes a later one', async () => {
        // This window was still starting when the other window saved the pig and removed a pet, so it missed both.
        act(() => storage.getState().upsertLocalPetSource(pigSource));
        saveLocalSettings({ ...storage.getState().localSettings, petsSelectedPetOverride: pigOverride });
        saveLocalPetSourcesBySourceKey({});
        await startSync();
        takeAnnouncements();
        const otherSource = { ...pigSource, sourceKey: 'pet:other', petId: 'other', displayName: 'Other' };

        act(() => {
            deliverFromAnotherWindow({
                localSettings: { petsCompanionSizeScale: 1.25 },
                localPetSources: { [otherSource.sourceKey]: otherSource },
            });
        });

        expect(storage.getState().localSettings.petsCompanionSizeScale).toBe(1.25);
        expect(loadLocalSettings().petsSelectedPetOverride).toEqual(pigOverride);
        expect(loadLocalPetSourcesBySourceKey()).toEqual({});
        expect(takeAnnouncements()).toEqual([]);
    });

    it('keeps what it has when another window sends nothing new or something it cannot read', async () => {
        await startSync();
        act(() => storage.getState().upsertLocalPetSource(pigSource));
        const settingsBefore = storage.getState().localSettings;
        const sourcesBefore = storage.getState().localPetSourcesBySourceKey;

        act(() => {
            deliverFromAnotherWindow({ localSettings: { petsCompanionSizeScale: settingsBefore.petsCompanionSizeScale } });
            deliverFromAnotherWindow({ localSettings: 'not settings' });
            // Fails the settings schema as a whole: the parser's answer to that is every default, which must not land.
            deliverFromAnotherWindow({ localSettings: { petsCompanionSizeScale: 2, petsSelectedPetOverride: { kind: 'nonsense' } } });
            // An entry that does not read is skipped, even under a key this window holds: it neither clears nor replaces.
            deliverFromAnotherWindow({ localPetSources: { 'pet:broken': { kind: 'junk' } } });
            deliverFromAnotherWindow({ localPetSources: { [pigSource.sourceKey]: { kind: 'junk' } } });
        });

        expect(storage.getState().localSettings).toBe(settingsBefore);
        expect(storage.getState().localPetSourcesBySourceKey).toBe(sourcesBefore);
    });
});
