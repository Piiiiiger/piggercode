import type { LocalPetSourceMetadata } from '@/sync/domains/pets/localPetSourceMetadata';
import { areAccountSettingsJsonValuesEqual } from '@/sync/domains/settings/accountSettingsStructuralEquality';
import { tryParseLocalSettings } from '@/sync/domains/settings/localSettings';
import { parseLocalPetSourcesBySourceKey } from '@/sync/domains/state/persistence';
import { storage } from '@/sync/domains/state/storage';
import { emitTauriEvent, listenTauriEvent } from '@/utils/platform/tauri';
import { fireAndForget } from '@/utils/system/fireAndForget';

/** Sent by a desktop window when its local settings or local pet library changed. */
export const DESKTOP_LOCAL_STATE_CHANGED_EVENT = 'desktop_local_state_changed';

type LocalSettingsChanges = Readonly<Record<string, unknown>>;
/** By source key: the new entry, or null when the pet was removed. */
type LocalPetSourceChanges = Readonly<Record<string, LocalPetSourceMetadata | null>>;

type DesktopLocalStateAnnouncement = Readonly<{
    v: 1;
    senderId: string;
    localSettings?: LocalSettingsChanges;
    localPetSources?: LocalPetSourceChanges;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readAnnouncement(payload: unknown): DesktopLocalStateAnnouncement | null {
    if (!isRecord(payload) || payload.v !== 1 || typeof payload.senderId !== 'string') return null;
    return {
        v: 1,
        senderId: payload.senderId,
        ...(isRecord(payload.localSettings) ? { localSettings: payload.localSettings } : {}),
        ...(isRecord(payload.localPetSources) ? { localPetSources: payload.localPetSources as LocalPetSourceChanges } : {}),
    };
}

/** The keys whose values differ, with their new values (a key that disappeared is not a change: settings keep every key). */
function changedEntries<T>(previous: Readonly<Record<string, T>>, next: Readonly<Record<string, T>>): Record<string, T> {
    const changes: Record<string, T> = {};
    for (const [key, value] of Object.entries(next)) {
        if (!areAccountSettingsJsonValuesEqual(previous[key], value)) changes[key] = value;
    }
    return changes;
}

function changedPetSources(
    previous: Readonly<Record<string, LocalPetSourceMetadata>>,
    next: Readonly<Record<string, LocalPetSourceMetadata>>,
): Record<string, LocalPetSourceMetadata | null> {
    const changes: Record<string, LocalPetSourceMetadata | null> = changedEntries(previous, next);
    for (const key of Object.keys(previous)) {
        if (!(key in next)) changes[key] = null;
    }
    return changes;
}

function isEmpty(record: Readonly<Record<string, unknown>>): boolean {
    return Object.keys(record).length === 0;
}

function createSenderId(): string {
    return `window-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Keeps this device's local state the same in every window of the desktop app.
 *
 * The desktop app runs two webviews, the main window and the pet overlay, and each loads its own store from storage
 * when it starts. Without this, a local setting or local pet changed in one (the pet chosen for this device in
 * Settings) stayed unseen in the other until the app restarted, and the other's next write of its whole stale copy
 * (dismissing a bubble, tucking the pet) put the old values back.
 *
 * Each window announces what changed, key by key, on a Tauri event, and every other window merges those changes into
 * its own copy, in memory only: the announcing window saved them, and a window writes storage only for its own
 * changes, whose save then carries everything it has taken. So a window that missed a change (it was still starting)
 * cannot write it back over when it takes a later one, and two edits to different settings made at nearly the same
 * moment in two windows both stay in both copies, reaching storage with the next save. The values travel in the event
 * rather than being read back from storage, because WebKit does not reliably show one webview's localStorage writes to
 * another (WebKit bug 225344).
 *
 * A window starts this from its first render (`app/_layout.tsx` `RootLayout`), so what another window changes between
 * this window's store load and its listener being registered is only that one IPC registration wide. There is no
 * catch-up exchange: a full-state reply cannot tell a removal from "not mentioned", and a reply in flight would undo
 * an edit made meanwhile.
 *
 * Starts announcing and taking local state for this window and returns the stop. Desktop (Tauri) windows only.
 */
export function startDesktopLocalStateSync(): () => void {
    const senderId = createSenderId();
    let takingAnnouncement = false;
    let stopped = false;
    let stopListening: (() => void) | null = null;

    const announce = (announcement: Omit<DesktopLocalStateAnnouncement, 'v' | 'senderId'>) => {
        fireAndForget(
            emitTauriEvent<DesktopLocalStateAnnouncement>(DESKTOP_LOCAL_STATE_CHANGED_EVENT, { v: 1, senderId, ...announcement }),
            { tag: 'desktopLocalStateSync.announce' },
        );
    };

    const takeAnnouncement = (payload: unknown) => {
        const announcement = readAnnouncement(payload);
        if (!announcement || announcement.senderId === senderId || stopped) return;
        takingAnnouncement = true;
        try {
            if (announcement.localSettings && !isEmpty(announcement.localSettings)) {
                // Null when the merged settings do not parse at all: everything is kept (the parser's own answer to
                // that is every default, which must not replace settings this window holds).
                const localSettings = tryParseLocalSettings({
                    ...storage.getState().localSettings,
                    ...announcement.localSettings,
                });
                if (localSettings) storage.getState().replaceLocalSettingsFromOtherWindow(localSettings);
            }
            if (announcement.localPetSources && !isEmpty(announcement.localPetSources)) {
                const sources = { ...storage.getState().localPetSourcesBySourceKey };
                for (const [sourceKey, entry] of Object.entries(announcement.localPetSources)) {
                    if (entry === null) {
                        delete sources[sourceKey];
                        continue;
                    }
                    // Each entry is read on its own: one that does not read is skipped, whatever was under its key stays.
                    const readEntry = parseLocalPetSourcesBySourceKey({ [sourceKey]: entry })?.[sourceKey];
                    if (readEntry) sources[sourceKey] = readEntry;
                }
                storage.getState().replaceLocalPetSourcesFromOtherWindow(sources);
            }
        } finally {
            takingAnnouncement = false;
        }
    };

    fireAndForget(
        listenTauriEvent<unknown>(DESKTOP_LOCAL_STATE_CHANGED_EVENT, takeAnnouncement).then((stop) => {
            if (stopped) stop();
            else stopListening = stop;
        }),
        { tag: 'desktopLocalStateSync.listen' },
    );

    const unsubscribe = storage.subscribe((state, previous) => {
        // What this window just took from another is not news to anyone.
        if (takingAnnouncement) return;
        if (
            state.localSettings === previous.localSettings
            && state.localPetSourcesBySourceKey === previous.localPetSourcesBySourceKey
        ) {
            return;
        }
        const localSettings = changedEntries(previous.localSettings, state.localSettings);
        const localPetSources = changedPetSources(previous.localPetSourcesBySourceKey, state.localPetSourcesBySourceKey);
        if (isEmpty(localSettings) && isEmpty(localPetSources)) return;
        announce({
            ...(isEmpty(localSettings) ? {} : { localSettings }),
            ...(isEmpty(localPetSources) ? {} : { localPetSources }),
        });
    });

    return () => {
        stopped = true;
        unsubscribe();
        stopListening?.();
    };
}
