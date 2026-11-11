/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { createWheelTurnReporter, type WheelTurnTerminal } from './wheelTurns';

const ROW_HEIGHT = 20;

function terminal(overrides: Partial<{ takesWheel: boolean; speed: number; rows: number }> = {}) {
    const turns: number[] = [];
    const dispatched: WheelEvent[] = [];
    const target: WheelTurnTerminal = {
        takesWheel: () => overrides.takesWheel ?? true,
        rowHeight: () => ROW_HEIGHT,
        rows: () => overrides.rows ?? 24,
        speed: () => overrides.speed ?? 1,
        dispatch: (turn) => {
            dispatched.push(turn);
            turns.push(turn.deltaY);
        },
    };
    return { target, turns, dispatched };
}

const pixels = (deltaY: number, init: WheelEventInit = {}) =>
    new WheelEvent('wheel', { deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL, clientX: 30, clientY: 40, ...init });

describe('createWheelTurnReporter', () => {
    it('reports one wheel turn per line a trackpad has moved, carrying part of a line to the next event', () => {
        const { target, turns } = terminal();
        const onWheel = createWheelTurnReporter(target);

        expect(onWheel(pixels(2.5 * ROW_HEIGHT))).toBe(false);
        expect(turns).toEqual([1, 1]);
        expect(onWheel(pixels(0.5 * ROW_HEIGHT))).toBe(false);
        expect(turns).toEqual([1, 1, 1]);
        expect(onWheel(pixels(-0.6 * ROW_HEIGHT))).toBe(false);
        expect(turns).toEqual([1, 1, 1]);
    });

    it('scrolls a wheel that counts in lines or pages by that many lines', () => {
        const { target, turns } = terminal({ rows: 5 });
        const onWheel = createWheelTurnReporter(target);

        onWheel(new WheelEvent('wheel', { deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE }));
        expect(turns).toEqual([-1, -1, -1]);
        onWheel(new WheelEvent('wheel', { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE }));
        expect(turns).toEqual([-1, -1, -1, 1, 1, 1, 1, 1]);
    });

    it('scrolls at the chosen wheel speed', () => {
        const { target, turns } = terminal({ speed: 0.5 });
        createWheelTurnReporter(target)(pixels(4 * ROW_HEIGHT));
        expect(turns).toEqual([1, 1]);
    });

    it('reports each turn where the wheel was, as a one-line wheel event xterm reports once', () => {
        const { target, dispatched } = terminal();
        createWheelTurnReporter(target)(pixels(ROW_HEIGHT));
        expect(dispatched).toHaveLength(1);
        const [turn] = dispatched;
        expect({ deltaMode: turn!.deltaMode, deltaY: turn!.deltaY, clientX: turn!.clientX, clientY: turn!.clientY })
            .toEqual({ deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: 1, clientX: 30, clientY: 40 });
    });

    it('leaves to xterm its own turns, the wheel of a program that does not take it, and a wheel with a key held', () => {
        const { target, turns, dispatched } = terminal();
        const onWheel = createWheelTurnReporter(target);
        onWheel(pixels(ROW_HEIGHT));
        expect(onWheel(dispatched[0]!)).toBe(true);
        expect(onWheel(pixels(ROW_HEIGHT, { altKey: true }))).toBe(true);
        expect(turns).toEqual([1]);

        const scrolling = terminal({ takesWheel: false });
        expect(createWheelTurnReporter(scrolling.target)(pixels(3 * ROW_HEIGHT))).toBe(true);
        expect(scrolling.turns).toEqual([]);
    });
});
