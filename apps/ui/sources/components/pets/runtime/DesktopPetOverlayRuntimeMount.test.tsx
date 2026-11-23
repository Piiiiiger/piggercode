import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import type { PetCompanionActivityState } from '@/components/pets/state/buildPetCompanionActivityState';
import type { Settings } from '@/sync/domains/settings/settings';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';

type AccountPetsSettingsSubset = Pick<
    Settings,
    'petsEnabled' | 'petsDesktopOverlayDefaultEnabled' | 'petsDesktopOverlayDefaultVisibilityMode'
>;

type LocalPetsSettingsSubset = Pick<
    LocalSettings,
    | 'petsEnabledOverride'
    | 'desktopPetOverlayEnabledOverride'
    | 'desktopPetOverlayVisibilityModeOverride'
    | 'desktopPetOverlayAnchor'
    | 'desktopPetOverlayLocked'
> & { petsCompanionSizeScale: number };

const desktopRuntimeProps = vi.hoisted(() => ({
    calls: [] as Record<string, unknown>[],
}));
const listenDesktopPetOverlayShowMainWindowRequestedMock = vi.hoisted(() =>
    vi.fn(async (_handler: (payload: { targetSessionId?: string }) => void | Promise<void>) => () => {}),
);
const executePetOverlayMainWindowActionMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const createDefaultActionExecutorMock = vi.hoisted(() =>
    vi.fn(() => ({
        execute: executePetOverlayMainWindowActionMock,
    })),
);
const featureState = vi.hoisted(() => ({
    companionEnabled: true,
}));
const platformState = vi.hoisted(() => ({
    os: 'web',
    tauri: true,
}));
const activityState = vi.hoisted((): { current: PetCompanionActivityState } => ({
    current: {
        state: 'running',
        reason: 'running',
        sessionId: 'session-running',
        trayItems: [
            {
                id: 'running:session-running:live',
                dismissKey: 'running:session-running:live',
                sessionId: 'session-running',
                status: 'running',
                priority: 0,
                title: 'Running session',
                subtitle: null,
                activityAtMs: null,
                expiresAtMs: null,
                actions: {
                    open: true,
                    dismiss: true,
                    quickReply: true,
                },
            },
        ],
    },
}));
const accountSettingsState = vi.hoisted((): { current: AccountPetsSettingsSubset } => ({
    current: {
        petsEnabled: true,
        petsDesktopOverlayDefaultEnabled: true,
        petsDesktopOverlayDefaultVisibilityMode: 'alwaysWhenEnabled',
    },
}));
const localSettingsState = vi.hoisted((): { current: LocalPetsSettingsSubset } => ({
    current: {
        petsEnabledOverride: 'inherit',
        desktopPetOverlayEnabledOverride: 'inherit',
        desktopPetOverlayVisibilityModeOverride: 'inherit',
        desktopPetOverlayAnchor: 'bottomRight',
        desktopPetOverlayLocked: false,
        petsCompanionSizeScale: 1,
    },
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platformState.os;
            },
        },
    };
});

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => platformState.tauri,
    listenTauriEvent: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
        const listener = { event, handler };
        tauriBus.listeners.push(listener);
        return () => {
            tauriBus.listeners = tauriBus.listeners.filter((candidate) => candidate !== listener);
        };
    }),
    emitTauriEvent: vi.fn(async (event: string, payload: unknown) => {
        tauriBus.emitted.push({ event, payload });
    }),
}));

vi.mock('@/components/pets/desktop/runtime/DesktopPetOverlayRuntime', () => ({
    DesktopPetOverlayRuntime: (props: Record<string, unknown>) => {
        desktopRuntimeProps.calls.push(props);
        return React.createElement('DesktopPetOverlayRuntime', props);
    },
}));

vi.mock('@/components/pets/desktop/bridge/desktopPetOverlayBridge', () => ({
    listenDesktopPetOverlayShowMainWindowRequested: listenDesktopPetOverlayShowMainWindowRequestedMock,
}));

vi.mock('@/sync/ops/actions/defaultActionExecutor', () => ({
    createDefaultActionExecutor: createDefaultActionExecutorMock,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache', () => ({
    resolveServerIdForSessionIdFromLocalCache: (sessionId: string) => (sessionId === 'session-from-tray' ? 'server-pets' : null),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'pets.companion' && featureState.companionEnabled,
}));

vi.mock('@/components/pets/state/usePetCompanionActivityState', () => ({
    usePetCompanionActivityState: () => activityState.current,
}));

// The pet imported on this device; its spritesheet comes from the daemon over the machine RPC (the system boundary).
const pigSource = vi.hoisted(() => ({
    kind: 'happierManagedLocal' as const,
    sourceKey: 'managed:pig',
    digest: 'sha256:pig',
    daemonTarget: { machineId: 'machine-pets', serverId: 'server-pets' },
}));
// One object, as the real hook memoizes it: the spritesheet loads once per selected source.
const selectedPetPackageState = vi.hoisted(() => ({
    current: { enabled: true, source: pigSource as { kind: 'happierManagedLocal'; sourceKey: string; digest: string; daemonTarget: { machineId: string; serverId: string } }, fallback: null },
}));
// The Tauri event bus between the app's webviews is the system boundary for what the overlay window reports.
const tauriBus = vi.hoisted(() => ({
    listeners: [] as Array<Readonly<{ event: string; handler: (payload: unknown) => void }>>,
    emitted: [] as Array<Readonly<{ event: string; payload: unknown }>>,
}));

vi.mock('@/components/pets/source/useSelectedPetPackage', () => ({
    useSelectedPetPackage: () => selectedPetPackageState.current,
}));


vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    const actual = await importOriginal<typeof import('@/sync/domains/state/storage')>();
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    const { localSettingsDefaults } = await import('@/sync/domains/settings/localSettings');
    return createStorageModuleMock({
        importOriginal,
        overrides: {
            ...actual,
            useSettings: () => ({
                ...settingsDefaults,
                ...accountSettingsState.current,
            }),
            useLocalSettings: () => ({
                ...localSettingsDefaults,
                ...localSettingsState.current,
            }),
        },
    });
});

describe('DesktopPetOverlayRuntimeMount', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(12_000);
        activityState.current = {
            state: 'running',
            reason: 'running',
            sessionId: 'session-running',
            trayItems: [
                {
                    id: 'running:session-running:live',
                    dismissKey: 'running:session-running:live',
                    sessionId: 'session-running',
                    status: 'running',
                    priority: 0,
                    title: 'Running session',
                    subtitle: null,
                    activityAtMs: null,
                    expiresAtMs: null,
                    actions: {
                        open: true,
                        dismiss: true,
                        quickReply: true,
                    },
                },
            ],
        };
        listenDesktopPetOverlayShowMainWindowRequestedMock.mockResolvedValue(() => {});
        executePetOverlayMainWindowActionMock.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.useRealTimers();
        standardCleanup();
        desktopRuntimeProps.calls = [];
        selectedPetPackageState.current = { enabled: true, source: pigSource, fallback: null };
        tauriBus.listeners = [];
        tauriBus.emitted = [];
        listenDesktopPetOverlayShowMainWindowRequestedMock.mockReset();
        executePetOverlayMainWindowActionMock.mockReset();
        createDefaultActionExecutorMock.mockClear();
        featureState.companionEnabled = true;
        activityState.current = {
            state: 'running',
            reason: 'running',
            sessionId: 'session-running',
            trayItems: [
                {
                    id: 'running:session-running:live',
                    dismissKey: 'running:session-running:live',
                    sessionId: 'session-running',
                    status: 'running',
                    priority: 0,
                    title: 'Running session',
                    subtitle: null,
                    activityAtMs: null,
                    expiresAtMs: null,
                    actions: {
                        open: true,
                        dismiss: true,
                        quickReply: true,
                    },
                },
            ],
        };
        accountSettingsState.current = {
            petsEnabled: true,
            petsDesktopOverlayDefaultEnabled: true,
            petsDesktopOverlayDefaultVisibilityMode: 'alwaysWhenEnabled',
        };
        localSettingsState.current = {
            petsEnabledOverride: 'inherit',
            desktopPetOverlayEnabledOverride: 'inherit',
            desktopPetOverlayVisibilityModeOverride: 'inherit',
            desktopPetOverlayAnchor: 'bottomRight',
            desktopPetOverlayLocked: false,
            petsCompanionSizeScale: 1,
        };
        platformState.os = 'web';
        platformState.tauri = true;
        delete (globalThis as Partial<{ window: unknown }>).window;
    });

    it('mounts the desktop runtime without a hidden duplicate companion surface in the main app tree', async () => {
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        const screen = await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(screen.findByTestId('pet-companion-state')).toBeNull();
        expect(desktopRuntimeProps.calls[0]).toMatchObject({
            visible: true,
            expanded: true,
            policy: {
                enabled: true,
                visibilityMode: 'alwaysWhenEnabled',
                alwaysOnTop: true,
                // Click-through until the overlay says its pet is on screen.
                inputLocked: true,
                anchor: 'bottomRight',
            },
        });
        expect(desktopRuntimeProps.calls[0]?.window).toEqual({
            width: expect.any(Number),
            height: expect.any(Number),
        });
        expect((desktopRuntimeProps.calls[0]?.window as { width: number }).width).toBeGreaterThanOrEqual(320);
        expect((desktopRuntimeProps.calls[0]?.window as { height: number }).height).toBeGreaterThanOrEqual(280);
    });

    it('opens tray target sessions from native main-window requests in the main app runtime', async () => {
        let requestHandler: ((payload: { targetSessionId?: string }) => void | Promise<void>) | null = null;
        listenDesktopPetOverlayShowMainWindowRequestedMock.mockImplementation(async (handler) => {
            requestHandler = handler;
            return () => {};
        });
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(listenDesktopPetOverlayShowMainWindowRequestedMock).toHaveBeenCalledTimes(1);
        expect(createDefaultActionExecutorMock).toHaveBeenCalledWith(expect.objectContaining({
            resolveServerIdForSessionId: expect.any(Function),
            openSession: expect.any(Function),
        }));
        expect(requestHandler).not.toBeNull();

        await act(async () => {
            await requestHandler?.({ targetSessionId: 'session-from-tray' });
        });

        expect(executePetOverlayMainWindowActionMock).toHaveBeenCalledWith(
            'session.open',
            { sessionId: 'session-from-tray' },
            { defaultSessionId: 'session-from-tray' },
        );
    });

    it('keeps the overlay window up but out of the way of clicks until the overlay says its pet is on screen', async () => {
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');
        const { DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT, DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT } = await import(
            '@/components/pets/desktop/bridge/desktopPetOverlayPetAvailability'
        );
        const report = async (unavailable: boolean) => {
            await act(async () => {
                for (const listener of tauriBus.listeners) {
                    if (listener.event === DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT) listener.handler({ v: 1, unavailable });
                }
            });
        };

        await renderScreen(<DesktopPetOverlayRuntimeMount />);
        await flushHookEffects();
        // It asks the overlay once it listens, so a report sent before then is not lost.
        expect(tauriBus.emitted.map((entry) => entry.event)).toContain(DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT);
        expect(desktopRuntimeProps.calls.at(-1)).toMatchObject({ visible: true, policy: { inputLocked: true } });

        await report(false);
        expect(desktopRuntimeProps.calls.at(-1)).toMatchObject({ visible: true, policy: { inputLocked: false } });

        // Its pet is gone again (a failed reload): still up, so the overlay can keep trying, and clicks pass through.
        await report(true);
        expect(desktopRuntimeProps.calls.at(-1)).toMatchObject({ visible: true, policy: { inputLocked: true } });
    });

    it('keeps a pet the person locked in place locked once it is on screen', async () => {
        localSettingsState.current = { ...localSettingsState.current, desktopPetOverlayLocked: true };
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');
        const { DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT } = await import(
            '@/components/pets/desktop/bridge/desktopPetOverlayPetAvailability'
        );

        await renderScreen(<DesktopPetOverlayRuntimeMount />);
        await flushHookEffects();
        await act(async () => {
            for (const listener of tauriBus.listeners) {
                if (listener.event === DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT) listener.handler({ v: 1, unavailable: false });
            }
        });

        expect(desktopRuntimeProps.calls.at(-1)).toMatchObject({ visible: true, policy: { inputLocked: true } });
    });

    it('shows the desktop pet overlay when enabled even if the companion is idle', async () => {
        activityState.current = {
            state: 'idle',
            reason: 'idle',
            sessionId: null,
            trayItems: [],
        };
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        const screen = await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(screen.findByTestId('pet-companion-state')).toBeNull();
        expect(desktopRuntimeProps.calls[0]).toMatchObject({
            visible: true,
            expanded: false,
            policy: {
                enabled: true,
                visibilityMode: 'alwaysWhenEnabled',
            },
        });
        expect((desktopRuntimeProps.calls[0]?.window as { width: number }).width).toBeLessThan(192);
        expect((desktopRuntimeProps.calls[0]?.window as { height: number }).height).toBeLessThan(208);
    });

    it('sizes the compact desktop overlay window from the local companion size scale', async () => {
        activityState.current = {
            state: 'idle',
            reason: 'idle',
            sessionId: null,
            trayItems: [],
        };
        localSettingsState.current = {
            ...localSettingsState.current,
            petsCompanionSizeScale: 1.5,
        };
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(desktopRuntimeProps.calls[0]?.window).toEqual({
            width: 162,
            height: 174,
        });
    });

    it('keeps attention-or-active overlays visible for active idle sessions', async () => {
        activityState.current = {
            state: 'idle',
            reason: 'idle',
            sessionId: 'session-active-idle',
            trayItems: [],
        };
        accountSettingsState.current = {
            ...accountSettingsState.current,
            petsDesktopOverlayDefaultVisibilityMode: 'attentionOrActive',
        };
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        const screen = await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(screen.findByTestId('pet-companion-state')).toBeNull();
        expect(desktopRuntimeProps.calls[0]).toMatchObject({
            visible: true,
            expanded: false,
            policy: {
                enabled: true,
                visibilityMode: 'attentionOrActive',
            },
        });
    });

    it('hides attention-or-active overlays when there is no active or attention-bearing session', async () => {
        activityState.current = {
            state: 'idle',
            reason: 'idle',
            sessionId: null,
            trayItems: [],
        };
        accountSettingsState.current = {
            ...accountSettingsState.current,
            petsDesktopOverlayDefaultVisibilityMode: 'attentionOrActive',
        };
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(desktopRuntimeProps.calls[0]).toMatchObject({
            visible: false,
            expanded: false,
            policy: {
                enabled: true,
                visibilityMode: 'attentionOrActive',
            },
        });
    });

    it('does not sync overlay state from inside the pet overlay window route', async () => {
        Object.defineProperty(globalThis, 'window', {
            value: {
                location: {
                    href: 'http://localhost:8081/desktop/pet-overlay?desktopPetOverlayWindow=1',
                },
            },
            configurable: true,
            writable: true,
        });
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        const screen = await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(screen.findByTestId('pet-companion-state')).toBeNull();
        expect(desktopRuntimeProps.calls).toHaveLength(0);
    });

    it('does not mount the desktop overlay runtime in ordinary browser web', async () => {
        platformState.tauri = false;
        const { DesktopPetOverlayRuntimeMount } = await import('./DesktopPetOverlayRuntimeMount');

        const screen = await renderScreen(<DesktopPetOverlayRuntimeMount />);

        expect(screen.findByTestId('pet-companion-state')).toBeNull();
        expect(desktopRuntimeProps.calls).toHaveLength(0);
    });
});
