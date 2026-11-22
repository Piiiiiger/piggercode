import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';

import {
    DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT,
    DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT,
    useAnnounceDesktopPetOverlayPetAvailability,
    useDesktopPetOverlayPetUnavailable,
} from './desktopPetOverlayPetAvailability';

// The Tauri event bus between the app's webviews (main window, pet overlay) is the system boundary here: every emit
// reaches every listener, as Tauri's global events do.
const tauriBus = vi.hoisted(() => ({
    listeners: [] as Array<Readonly<{ event: string; handler: (payload: unknown) => void }>>,
    emitted: [] as Array<Readonly<{ event: string; payload: unknown }>>,
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => true,
    listenTauriEvent: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
        const listener = { event, handler };
        tauriBus.listeners.push(listener);
        return () => {
            tauriBus.listeners = tauriBus.listeners.filter((candidate) => candidate !== listener);
        };
    }),
    emitTauriEvent: vi.fn(async (event: string, payload: unknown) => {
        tauriBus.emitted.push({ event, payload });
        for (const listener of tauriBus.listeners) {
            if (listener.event === event) listener.handler(payload);
        }
    }),
}));

function announcementsSoFar(): unknown[] {
    return tauriBus.emitted.filter((entry) => entry.event === DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT).map((entry) => entry.payload);
}

describe('desktop pet overlay availability between the overlay and the main window', () => {
    afterEach(() => {
        standardCleanup();
        tauriBus.listeners = [];
        tauriBus.emitted = [];
    });

    it('tells the main window, even one that starts listening later, that the overlay has no pet to show', async () => {
        const overlay = await renderHook(
            ({ unavailable }: { unavailable: boolean | null }) => useAnnounceDesktopPetOverlayPetAvailability(unavailable),
            { initialProps: { unavailable: false as boolean | null } },
        );
        await overlay.rerender({ unavailable: true });
        expect(announcementsSoFar().at(-1)).toEqual({ v: 1, unavailable: true });

        // The main window comes up after that announcement: it asks, and the overlay answers.
        const main = await renderHook(() => useDesktopPetOverlayPetUnavailable());
        await flushHookEffects();
        expect(main.getCurrent()).toBe(true);
        expect(tauriBus.emitted.some((entry) => entry.event === DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT)).toBe(true);

        // Pets off for the overlay: it claims nothing new.
        const before = announcementsSoFar().length;
        await overlay.rerender({ unavailable: null });
        expect(announcementsSoFar()).toHaveLength(before);

        // A pet it can draw after all: the main window lets the overlay window show again.
        await overlay.rerender({ unavailable: false });
        await flushHookEffects();
        expect(main.getCurrent()).toBe(false);
        await overlay.unmount();
        await main.unmount();
    });

    it('ignores what does not read as an availability report', async () => {
        const main = await renderHook(() => useDesktopPetOverlayPetUnavailable());
        await flushHookEffects();
        expect(tauriBus.listeners.some((listener) => listener.event === DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT)).toBe(true);

        await act(async () => {
            for (const listener of tauriBus.listeners) {
                if (listener.event !== DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT) continue;
                listener.handler({ v: 2, unavailable: true });
                listener.handler({ v: 1, unavailable: 'yes' });
                listener.handler('junk');
            }
        });

        expect(main.getCurrent()).toBe(false);
        await main.unmount();
    });
});
