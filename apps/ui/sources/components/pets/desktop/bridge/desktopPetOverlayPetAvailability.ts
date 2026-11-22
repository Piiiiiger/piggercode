import * as React from 'react';

import { emitTauriEvent, isTauriDesktop, listenTauriEvent } from '@/utils/platform/tauri';
import { fireAndForget } from '@/utils/system/fireAndForget';

/** Sent by the pet overlay window: whether it can show a pet at all (pets are on for it, but it has none to draw). */
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
 * The overlay window's side: says whether it can show a pet, on every change and when the main window asks.
 *
 * The main window decides whether the overlay window is shown (`DesktopPetOverlayRuntimeMount`), but the overlay is
 * the window that resolves, loads and draws the pet, from its own copy of the selection and libraries. When pets are
 * on for it and it has no pet to draw (none resolves here, or its spritesheet failed), nothing stands in (there is no
 * built-in pet), and the always-on-top window left up empty would still take clicks, so the main window hides it on
 * this report. The main window does not load the spritesheet to find out itself: the daemon takes one preview read per
 * interval for all callers, so two windows reading together refuse each other, and their answers could disagree.
 *
 * `unavailable` is null while pets are off for the overlay: it then claims nothing (the main window has its own gate).
 */
export function useAnnounceDesktopPetOverlayPetAvailability(unavailable: boolean | null): void {
    const latestRef = React.useRef<DesktopPetOverlayPetAvailability | null>(null);

    React.useEffect(() => {
        latestRef.current = unavailable === null ? null : { v: 1, unavailable };
        if (latestRef.current) announce(latestRef.current);
    }, [unavailable]);

    useTauriEventListener(DESKTOP_PET_OVERLAY_PET_AVAILABILITY_QUERY_EVENT, () => {
        if (latestRef.current) announce(latestRef.current);
    });
}

/**
 * The main window's side: whether the overlay last said it has no pet to show (false until it says anything). It asks
 * the overlay once it listens, so a report sent before the main window was listening is not lost.
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

    return report?.unavailable === true;
}
