import * as React from 'react';
import { Platform } from 'react-native';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { readUiDeploymentId, reduceUiDeploymentFreshness, type UiDeploymentFreshnessState } from './uiDeploymentFreshness';

/**
 * One freshness check for the whole web app (the S-3 rule applied to the web build): every surface
 * that shows "This app" subscribes here instead of fetching the deployment identity on its own.
 * Checks on first use, on reconnect, when the tab becomes visible again, and on "Check for updates".
 */
let state: UiDeploymentFreshnessState = { baselineId: null, updateAvailable: false };
// When the server last answered which deployment it serves.
let checkedAt: number | null = null;
let started = false;
const listeners = new Set<() => void>();

async function checkDeploymentFreshness(): Promise<void> {
    if (Platform.OS !== 'web' || typeof globalThis.fetch !== 'function') return;
    try {
        const response = await globalThis.fetch('/.well-known/happier-ui-deployment', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok || response.status === 204) return;
        const payload = await response.json() as { deploymentId?: unknown };
        // An answer without a usable identity says nothing about freshness, so it is not a check that happened.
        const deploymentId = readUiDeploymentId(payload.deploymentId);
        if (!deploymentId) return;
        state = reduceUiDeploymentFreshness(state, deploymentId);
        checkedAt = Date.now();
        for (const listener of listeners) listener();
    } catch {
        // Missing, malformed, and temporarily unavailable identities are intentionally silent.
    }
}

function start(): void {
    if (started || Platform.OS !== 'web') return;
    started = true;
    void checkDeploymentFreshness();
    apiSocket.onReconnected(() => void checkDeploymentFreshness());
    const doc = (globalThis as { document?: Document }).document;
    doc?.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible') void checkDeploymentFreshness();
    });
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    start();
    return () => {
        listeners.delete(listener);
    };
}

function readUpdateAvailable(): boolean {
    return state.updateAvailable;
}

function readCheckedAt(): number | null {
    return checkedAt;
}

function reload(): void {
    if (Platform.OS === 'web') (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
}

export function useWebUiDeploymentFreshness(): Readonly<{
    updateAvailable: boolean;
    /** When the server last answered which deployment it serves (ms); null before that, and off the web. */
    checkedAt: number | null;
    reload: () => void;
    /** The explicit "Check for updates": asks the server now. */
    check: () => Promise<void>;
}> {
    const updateAvailable = React.useSyncExternalStore(subscribe, readUpdateAvailable, readUpdateAvailable);
    const answeredAt = React.useSyncExternalStore(subscribe, readCheckedAt, readCheckedAt);
    return React.useMemo(
        () => ({ updateAvailable, checkedAt: answeredAt, reload, check: checkDeploymentFreshness }),
        [answeredAt, updateAvailable],
    );
}
