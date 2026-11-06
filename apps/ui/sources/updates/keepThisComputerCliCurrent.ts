import * as React from 'react';

import type { DesktopLocalInspection, DesktopSetupExpectation } from '@/setup/deriveDesktopLocalSetupSnapshot';
import { listThisComputerRelayRows } from '@/setup/thisComputerRelayRows';

import type { UpdateItem } from './items/updateItem';

/**
 * Whether the desktop app may update this computer's command line by itself. The update restarts
 * every running service of this home, so it must be the app's alone and in order: the CLI is one
 * the app installed; every service here is listed (the executor read them all) and is one the app
 * manages — never a service the user set up; and the service for the app's relay is `connected`
 * for the account the app is on (not mid-switch, not signed in as someone else). Anything less
 * leaves the row's own Update button to the person. Judged through the projection the connection
 * popover, the tray and Settings render (`listThisComputerRelayRows`).
 */
export function canKeepThisComputerCliCurrent(
    inspection: DesktopLocalInspection,
    appRelay: DesktopSetupExpectation | null,
): boolean {
    if (!appRelay || appRelay.accountId === null) return false;
    // This computer's one CLI, which every service here runs.
    if (inspection.status !== 'resolved' || inspection.facts.acquisition.provenance !== 'managed') return false;
    const relays = listThisComputerRelayRows(inspection, appRelay);
    return relays.status === 'listed'
        && relays.complete
        && relays.rows.length > 0
        && relays.rows.every((row) => row.appManaged)
        && relays.rows.some((row) => row.appRelay && row.state === 'connected');
}

/**
 * The desktop app keeps this computer's command line current by itself: it looks for a newer one
 * when the app opens (and on "check for updates", `useCheckForUpdatesNow`), and when its row says
 * one is available it installs it — through the same update the row's button runs. Such a computer
 * runs no agents, so its service restarting only reconnects shared folders for a moment. Only when
 * `allowed` (`canKeepThisComputerCliCurrent`); once per version in an app session: a failed update
 * stays on the row with its retry and is not repeated by itself.
 */
export function useKeepThisComputerCliCurrent(params: Readonly<{
    enabled: boolean;
    allowed: boolean;
    item: UpdateItem | null;
    /** The update would start now; until then a version offered is not counted as tried. */
    canUpdate: boolean;
    check: () => Promise<void>;
    update: () => Promise<void>;
}>): void {
    const { enabled, allowed, item, canUpdate, check, update } = params;
    const checked = React.useRef(false);
    React.useEffect(() => {
        if (!enabled || !allowed || checked.current) return;
        checked.current = true;
        void check();
    }, [allowed, check, enabled]);

    const offered = item?.state === 'available' && item.action.kind === 'run' && item.action.verb === 'update'
        ? item.latestVersion
        : null;
    const attempted = React.useRef(new Set<string>());
    React.useEffect(() => {
        if (!enabled || !allowed || !canUpdate || !offered || attempted.current.has(offered)) return;
        attempted.current.add(offered);
        void update();
    }, [allowed, canUpdate, enabled, offered, update]);
}
