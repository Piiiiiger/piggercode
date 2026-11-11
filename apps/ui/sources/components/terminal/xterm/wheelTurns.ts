/**
 * The wheel of a program that takes the mouse: tmux in a 「终端」 view (its scroll-back), or a full-screen CLI.
 *
 * xterm.js 5.5 reports one wheel turn per wheel event, however far the event scrolled, and tmux moved its
 * scroll-back five lines per turn. A trackpad or a smooth-scrolling wheel sends many small events, so the same hand
 * movement scrolled several times as far as on a notched wheel. This reports one turn per line the event scrolled
 * (pixels counted in rows, part of a line carried to the next event), as native terminals do; the attach plan
 * (`apps/cli/src/terminal/attachment/tmuxSingleWindowAttachPlan.ts`) makes tmux move one line per turn.
 * Each turn goes back through xterm as a one-line wheel event, so xterm still writes the report in the encoding the
 * program asked for.
 */
export type WheelTurnTerminal = Readonly<{
    /** True while the program takes wheel reports (mouse tracking that includes the wheel). */
    takesWheel: () => boolean;
    /** One row's height in CSS pixels. */
    rowHeight: () => number;
    rows: () => number;
    /** Lines scrolled per line the wheel moved: the wheel speed setting. */
    speed: () => number;
    /** Hands one turn to xterm. */
    dispatch: (turn: WheelEvent) => void;
}>;

function linesMoved(event: WheelEvent, terminal: WheelTurnTerminal): number | null {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * terminal.rows();
    const rowHeight = terminal.rowHeight();
    return rowHeight > 0 ? event.deltaY / rowHeight : null;
}

/** A wheel handler for xterm's `attachCustomWheelEventHandler`: false when it reported the event itself. */
export function createWheelTurnReporter(terminal: WheelTurnTerminal): (event: WheelEvent) => boolean {
    const ownTurns = new WeakSet<WheelEvent>();
    let carried = 0;

    return (event) => {
        if (ownTurns.has(event)) return true;
        // A wheel with a key held keeps xterm's own handling (its fast-scroll key, a program's modifier reports).
        if (!terminal.takesWheel() || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
            carried = 0;
            return true;
        }
        const lines = linesMoved(event, terminal);
        if (lines === null) return true;

        const total = carried + lines * terminal.speed();
        const turns = Math.trunc(total);
        carried = total - turns;
        const direction = Math.sign(turns);
        for (let i = 0; i < Math.abs(turns); i += 1) {
            const turn = new WheelEvent('wheel', {
                deltaY: direction,
                deltaMode: WheelEvent.DOM_DELTA_LINE,
                clientX: event.clientX,
                clientY: event.clientY,
                screenX: event.screenX,
                screenY: event.screenY,
                cancelable: true,
            });
            ownTurns.add(turn);
            terminal.dispatch(turn);
        }
        return false;
    };
}
