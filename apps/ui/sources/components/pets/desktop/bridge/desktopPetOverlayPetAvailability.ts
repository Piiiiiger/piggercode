import * as React from 'react';

import { emitTauriEvent, isTauriDesktop, listenTauriEvent } from '@/utils/platform/tauri';
import { fireAndForget } from '@/utils/system/fireAndForget';

/** Sent by the pet overlay window: whether it has no pet on screen (still loading, failed, or none to draw). */
export const DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT = 'desktop_pet_overlay_pet_availability';
/** Sent by the main window once it listens; the overlay answers with what it last announced. */
export const DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT = 'desktop_pet_overlay_pet_availability_query';

type DesktopPetOverlayPetAvailability = Readonly<{
    v: 1;
    unavailable: boolean;
}>;

function readAvailability(payload: unknown): DesktopPetOverlayPetAvailability | null {
    if (payload === null || typeof payload !== 'object') return null;
    const candidate = payload as Record<string, unknown>;
    if (candidate.v !== 1 || typeof candidate.unavailable !== 'boolean') return null;
    return { v: 1, unavailable: candidate.unavailable };
}

function announce(availability: DesktopPetOverlayPetAvailability): void {
    if (!isTauriDesktop()) return;
    fireAndForget(
        emitTauriEvent<DesktopPetOverlayPetAvailability>(DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT, availability),
        { tag: 'desktopPetOverlayPetAvailability.announce' },
    );
}

function useTauriEventListener(event: string, handler: (payload: unknown) => void, onListening?: () => void): void {
    const handlerRef = React.useRef(handler);
    handlerRef.current = handler;
    const onListeningRef = React.useRef(onListening);
    onListeningRef.current = onListening;

    React.useEffect(() => {
        let stopped = false;
        let stopListening: (() => void) | null = null;
        fireAndForget(
            listenTauriEvent<unknown>(event, (payload) => handlerRef.current(payload)).then((stop) => {
                if (stopped) {
                    stop();
                    return;
                }
                stopListening = stop;
                onListeningRef.current?.();
            }),
            { tag: `desktopPetOverlayPetAvailability.listen:${event}` },
        );
        return () => {
            stopped = true;
            stopListening?.();
        };
    }, [event]);
}

/**
 * The overlay window's side: says whether it has a pet on screen, on every change and when the main window asks.
 *
 * The main window owns the overlay window (`DesktopPetOverlayRuntimeMount`), but the overlay is the window that
 * resolves, loads and draws the pet, from its own copy of the selection and libraries. While it has no pet on screen
 * (still loading, failed, or none resolves here), nothing stands in (there is no built-in pet) and its empty
 * always-on-top window must not take clicks, so the main window makes it click-through on this report. It stays up
 * rather than parked offscreen: WebKit suspends the timers of a parked window, so the overlay could not ask again after
 * a failed load and the pet would not come back. The main window does not load the spritesheet to find out itself: the
 * daemon takes one preview read per interval for all callers, so two windows reading together refuse each other, and
 * their answers could disagree.
 */
export function useAnnounceDesktopPetOverlayPetAvailability(unavailable: boolean): void {
    const latestRef = React.useRef<DesktopPetOverlayPetAvailability>({ v: 1, unavailable });

    React.useEffect(() => {
        latestRef.current = { v: 1, unavailable };
        announce(latestRef.current);
    }, [unavailable]);

    // Also once it can hear the query: a main window listening by then gets this, and one that starts listening later
    // asks a window that can answer. So whichever window comes up first, the report arrives.
    useTauriEventListener(
        DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT,
        () => announce(latestRef.current),
        () => announce(latestRef.current),
    );
}

/**
 * The main window's side: whether the overlay has no pet on screen, true until it says it has one, so a window whose
 * page has not started does not take clicks. It asks the overlay once it listens, so a report sent before the main
 * window was listening is not lost.
 */
export function useDesktopPetOverlayPetUnavailable(): boolean {
    const [report, setReport] = React.useState<DesktopPetOverlayPetAvailability | null>(null);

    useTauriEventListener(
        DESKTOP_PET_OVERLAY_PET_AVAILABILITY_EVENT,
        (payload) => {
            const availability = readAvailability(payload);
            if (availability) setReport(availability);
        },
        () => {
            if (!isTauriDesktop()) return;
            fireAndForget(
                emitTauriEvent(DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT, { v: 1 }),
                { tag: 'desktopPetOverlayPetAvailability.query' },
            );
        },
    );

    return report?.unavailable !== false;
}
