import * as React from 'react';

// The app checks a person asked for ("Check for updates" on any surface, or a failed check asked
// again) that have not settled: every surface that offers the check shows it running until the last
// one settles, a failed one too.
let checksInFlight = 0;
const listeners = new Set<() => void>();

function publish(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function readInFlight(): boolean {
    return checksInFlight > 0;
}

/** Runs a check the person asked for, counted as running until it settles. */
export async function trackUpdateCheck(check: () => Promise<void>): Promise<void> {
    checksInFlight += 1;
    publish();
    try {
        await check();
    } finally {
        checksInFlight -= 1;
        publish();
    }
}

/**
 * Whether a check the person asked for is still running: this app's own checks (machines answer on
 * their own and show it on their rows when they do).
 */
export function useUpdateCheckInFlight(): boolean {
    return React.useSyncExternalStore(subscribe, readInFlight, readInFlight);
}
