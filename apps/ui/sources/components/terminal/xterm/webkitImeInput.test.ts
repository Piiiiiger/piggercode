import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebKitImeInput } from './webkitImeInput';

// The DOM events WebKit and Chrome send, in the orders recorded in xterm.js#5374 and #5887.
type Key = KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
const key = (type: 'keydown' | 'keyup' | 'keypress', name: string, keyCode: number, shiftKey = false): Key =>
    ({ type, key: name, keyCode, shiftKey, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn() }) as unknown as Key;
const typed = (data: string, init: Partial<InputEvent> = {}) =>
    ({ type: 'input', inputType: 'insertText', data, composed: true, isComposing: false, ...init }) as InputEvent;

describe('createWebKitImeInput', () => {
    let sent: string[];
    let ime: ReturnType<typeof createWebKitImeInput>;

    beforeEach(() => {
        vi.useFakeTimers();
        sent = [];
        ime = createWebKitImeInput((data) => sent.push(data));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('types the "(" of Shift+9 that WebKit inserts before the key, and cancels the key\'s own "9"', () => {
        ime.onKey(key('keydown', 'Shift', 16, true));
        ime.onInput(typed('('));
        const nine = key('keydown', '9', 57, true);

        expect(ime.onKey(nine)).toBe(false);
        expect(nine.preventDefault).toHaveBeenCalled();
        expect(ime.onKey(key('keypress', '9', 57, true))).toBe(false);
        ime.onKey(key('keyup', '9', 57, true));
        ime.onKey(key('keyup', 'Shift', 16));
        expect(sent).toEqual(['(']);
    });

    it('cancels the "9" of a second Shift+9 while Shift is still down, whose "(" xterm takes itself', () => {
        ime.onKey(key('keydown', 'Shift', 16, true));
        ime.onInput(typed('('));
        ime.onKey(key('keydown', '9', 57, true));
        ime.onKey(key('keyup', '9', 57, true));

        ime.onInput(typed('('));
        expect(ime.onKey(key('keydown', '9', 57, true))).toBe(false);
        expect(sent).toEqual(['(']);
    });

    it('types "()" typed fast with Shift down, the "0" going down before the "9" comes up', () => {
        ime.onKey(key('keydown', 'Shift', 16, true));
        ime.onInput(typed('('));
        expect(ime.onKey(key('keydown', '9', 57, true))).toBe(false);
        ime.onInput(typed(')'));
        expect(ime.onKey(key('keydown', '0', 48, true))).toBe(false);

        expect(sent).toEqual(['(', ')']);
    });

    it('leaves a keyCode 229 keydown after the insertion to xterm, which then finds nothing new', () => {
        ime.onKey(key('keydown', 'Shift', 16, true));
        ime.onInput(typed('（'));

        expect(ime.onKey(key('keydown', 'Process', 229, true))).toBe(true);
        expect(sent).toEqual(['（']);
    });

    it('leaves an insertion after a keyCode 229 keydown to xterm\'s own check, which runs after the first timer (Chrome)', () => {
        ime.onKey(key('keydown', 'Shift', 16, true));
        ime.onKey(key('keydown', 'Process', 229, true));
        vi.advanceTimersToNextTimer();
        ime.onInput(typed('（'));

        expect(sent).toEqual([]);
        expect(ime.onKey(key('keydown', '0', 48, true))).toBe(true);
    });

    it('types a character inserted while the previous key is still down, after xterm\'s check ran (#5887)', () => {
        ime.onKey(key('keydown', 'Process', 229));
        vi.runAllTimers();
        ime.onInput(typed('o'));

        expect(sent).toEqual(['o']);
    });

    it('leaves to xterm an insertion with no key down, while composing, or after xterm typed the keypress', () => {
        ime.onInput(typed('😀'));
        expect(ime.onKey(key('keydown', 'a', 65))).toBe(true);
        ime.onInput(typed('あ', { isComposing: true }));
        ime.onKey(key('keydown', 'A', 65, true));
        ime.onKey(key('keypress', 'A', 65, true));
        ime.onInput(typed('A'));

        expect(sent).toEqual([]);
    });

    it('lets the next keystroke type once the key came up', () => {
        ime.onKey(key('keydown', 'Shift', 16, true));
        ime.onInput(typed('('));
        ime.onKey(key('keyup', 'Shift', 16));

        expect(ime.onKey(key('keydown', 'a', 65))).toBe(true);
    });
});
