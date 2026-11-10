import type { DetailsTab } from '@/components/appShell/panes/model/appPaneReducer';
import { PANE_SIZING_DEFAULTS } from '@/components/appShell/panes/layout/paneSizing';
import { createSessionFileDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { resolvePaneLayout } from '@/components/ui/panels/paneBreakpoints';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';

/**
 * The ONE answer to "where does this session thing open — a pane, or a whole screen?".
 *
 * The app has always known the answer; it just knew it in four places. A transcript file link asked
 * `resolvePaneLayout` whether a details pane could exist and pushed `/session/<id>/file` when it
 * could not; the header's files button asked the same question about the RIGHT pane and pushed
 * `/session/<id>/files`; the header's agents button asked nothing at all and opened a pane that is
 * structurally hidden on a phone (a dead control); and the Agents pane asked `deviceType === 'phone'`
 * instead of the layout, so a narrow tablet window got the opposite answer from the row directly
 * above it. Four spellings of one decision is how a control ends up alive on one surface and dead on
 * the next.
 *
 * So the decision is here, once, as a pure function: given a target and the layout that would result
 * from opening the pane it wants, say whether it becomes a pane placement or a full-screen route.
 * Nothing here navigates — the hook (`useOpenSessionTarget`) applies the placement, because pushing
 * and dispatching are effects and this is the part worth testing without a renderer.
 *
 * **A target names WHAT is being opened, never WHERE.** That is the whole point: a caller that
 * already knew whether it wanted a tab or a route would be making this decision a fifth time.
 *
 * **The probe is "the layout that would exist if this pane were open", not the current one.** A pane
 * that is closed right now can still be opened; asking about the present layout would refuse to open
 * the first one.
 */

/** Which pane a target wants. Derived from the target, never passed in. */
export type SessionPaneSlot = 'details' | 'right';

export type SessionOpenTarget =
    /** A workspace file, at its details view. */
    | Readonly<{ kind: 'file'; path: string }>
    /** The workspace file browser — the right pane's Files tab, or its own screen. */
    | Readonly<{ kind: 'fileBrowser'; revealPath?: string }>
    | Readonly<{ kind: 'sourceControl' }>
    /**
     * The workspace shell terminal, in the sidebar. The `bottom` and `details` dock locations are a
     * user preference the caller resolves; only the sidebar location asks this question, because
     * only the sidebar is the right pane — and the right pane is the one that vanishes on a phone.
     */
    | Readonly<{ kind: 'terminal' }>;

export type SessionOpenPlacement =
    | Readonly<{ kind: 'route'; href: string }>
    | Readonly<{ kind: 'detailsTab'; tab: DetailsTab }>
    | Readonly<{ kind: 'rightTab'; tabId: 'files' | 'git' | 'terminal' }>;

export type SessionOpenLayout = Readonly<{
    containerWidthPx: number;
    deviceType: 'phone' | 'tablet';
    multiPaneEnabled: boolean;
}>;

function probeLayout(
    layout: SessionOpenLayout,
    open: Readonly<{ right: boolean; details: boolean }>,
) {
    // The pane HOST's own sizing constants, including the three-pane main minimum. Any number
    // spelled again here is a number that can drift from the pane that actually gets drawn.
    return resolvePaneLayout({
        containerWidthPx: layout.containerWidthPx,
        deviceType: layout.deviceType,
        multiPaneEnabled: layout.multiPaneEnabled,
        rightOpen: open.right,
        detailsOpen: open.details,
        mainMinPx: PANE_SIZING_DEFAULTS.mainMinPx,
        mainMinPxThreePane: PANE_SIZING_DEFAULTS.mainMinThreePanePx,
        rightMinPx: PANE_SIZING_DEFAULTS.right.minPx,
        detailsMinPx: PANE_SIZING_DEFAULTS.details.minPx,
    });
}

/**
 * Whether this layout has room for that pane at all, which is the question every caller was asking
 * in its own words. `single` is the one answer that means "there is nowhere to put a pane here" —
 * a phone, multi-pane switched off, or a window too narrow for main + pane minimums.
 */
export function canLayoutHostSessionPane(
    layout: SessionOpenLayout,
    slot: SessionPaneSlot,
): boolean {
    const resolved = probeLayout(layout, { right: slot === 'right', details: slot === 'details' });
    return resolved.kind !== 'single';
}

/**
 * The same question asked in the RETURN direction: a full-screen route deciding whether to hand its
 * content back to a pane and get out of the way.
 *
 * It is deliberately stricter than `canLayoutHostSessionPane`, and this is the one place that
 * difference is written down. Opening asks "is there anywhere at all to draw this" — an overlay
 * counts, because an overlay pane is drawn and the press must do something. Handing back asks "is
 * there room to draw this *beside* the transcript" — an overlay is not an improvement on the screen
 * the user is already looking at, so the route stays. The probe opens BOTH auxiliary panes because
 * the pane it hands back to has to survive the user's other pane still being open; a slot that
 * degrades to an overlay the moment the sidebar opens is not a docked destination.
 */
export function canLayoutDockSessionPane(
    layout: SessionOpenLayout,
    slot: SessionPaneSlot,
): boolean {
    const resolved = probeLayout(layout, { right: true, details: true });
    return resolved.kind !== 'single' && resolved[slot] === 'docked';
}

export function resolveSessionOpenPlacement(params: Readonly<{
    sessionId: string;
    /** Carried into every route this builds, so a multi-server deep link survives the jump. */
    serverId?: string | null;
    target: SessionOpenTarget;
    layout: SessionOpenLayout;
}>): SessionOpenPlacement | null {
    const sessionId = params.sessionId.trim();
    if (!sessionId) return null;

    const { layout, target } = params;
    const route = (suffix: string, query?: Readonly<Record<string, string>>): SessionOpenPlacement => ({
        kind: 'route',
        href: buildScopedSessionRouteHref({
            sessionId,
            ...(params.serverId ? { serverId: params.serverId } : null),
            suffix,
            ...(query ? { query } : null),
        }),
    });

    switch (target.kind) {
        case 'file': {
            const path = target.path.trim();
            if (!path) return null;
            if (!canLayoutHostSessionPane(layout, 'details')) return route('/file', { path });
            return { kind: 'detailsTab', tab: createSessionFileDetailsTab(path) };
        }
        case 'fileBrowser': {
            if (!canLayoutHostSessionPane(layout, 'right')) return route('/files');
            return { kind: 'rightTab', tabId: 'files' };
        }
        case 'sourceControl': {
            if (!canLayoutHostSessionPane(layout, 'right')) return route('/git');
            return { kind: 'rightTab', tabId: 'git' };
        }
        case 'terminal': {
            if (!canLayoutHostSessionPane(layout, 'right')) return route('/terminal');
            return { kind: 'rightTab', tabId: 'terminal' };
        }
        default: {
            const exhaustive: never = target;
            return exhaustive;
        }
    }
}
