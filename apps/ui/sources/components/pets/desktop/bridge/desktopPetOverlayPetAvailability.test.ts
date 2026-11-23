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
    /** Registration of this event's listeners waits for `releaseHeld`, as a slow IPC round trip would. */
    heldEvent: null as string | null,
    releaseHeld: [] as Array<() => void>,
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => true,
    listenTauriEvent: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
        if (tauriBus.heldEvent === event) {
            await new Promise<void>((resolve) => tauriBus.releaseHeld.push(resolve));
        }
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
        tauriBus.heldEvent = null;
        tauriBus.releaseHeld = [];
    });

    it('counts the overlay as having no pet on screen until it says it has one', async () => {
        const main = await renderHook(() => useDesktopPetOverlayPetUnavailable());
        await flushHookEffects();

        expect(main.getCurrent()).toBe(true);
        await main.unmount();
    });

    it('tells the main window, even one that starts listening later, whether the overlay has a pet on screen', async () => {
        const overlay = await renderHook(
            ({ unavailable }: { unavailable: boolean }) => useAnnounceDesktopPetOverlayPetAvailability(unavailable),
            { initialProps: { unavailable: true } },
        );
        await overlay.rerender({ unavailable: false });
        expect(announcementsSoFar().at(-1)).toEqual({ v: 1, unavailable: false });

        // The main window comes up after that announcement: it asks, and the overlay answers.
        const main = await renderHook(() => useDesktopPetOverlayPetUnavailable());
        await flushHookEffects();
        expect(main.getCurrent()).toBe(false);
        expect(tauriBus.emitted.some((entry) => entry.event === DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT)).toBe(true);

        await overlay.rerender({ unavailable: true });
        await flushHookEffects();
        expect(main.getCurrent()).toBe(true);
        await overlay.unmount();
        await main.unmount();
    });

    it('reaches a main window whose query went out before the overlay could hear it', async () => {
        // The overlay's first report goes out with nobody listening, and its query listener is still registering.
        tauriBus.heldEvent = DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT;
        const overlay = await renderHook(() => useAnnounceDesktopPetOverlayPetAvailability(false));

        // The main window comes up in that gap: it listens and asks, and nobody hears the question.
        const main = await renderHook(() => useDesktopPetOverlayPetUnavailable());
        await flushHookEffects();
        expect(main.getCurrent()).toBe(true);

        await act(async () => {
            for (const release of tauriBus.releaseHeld) release();
        });
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
                listener.handler({ v: 2, unavailable: false });
                listener.handler({ v: 1, unavailable: 'no' });
                listener.handler('junk');
            }
        });

        expect(main.getCurrent()).toBe(true);
        await main.unmount();
    });
});
