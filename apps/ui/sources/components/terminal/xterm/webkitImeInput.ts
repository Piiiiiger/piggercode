/**
 * WebKit (the desktop app on macOS, Safari) with a Chinese or Japanese input method inserts the character a shifted
 * key types, such as the "(" of Shift+9, before that key's keydown. xterm.js 5.5 drops such an insertion while a key is
 * down (its `_keyDownSeen`, which Shift's keydown sets), and the keydown that follows then types its own "9". This sends
 * an insertion xterm drops and cancels the keydown of a key whose character was already inserted; everything xterm
 * handles itself is left to it.
 * Upstream: https://github.com/xtermjs/xterm.js/issues/5887 (open). Remove this once xterm.js accepts these insertions.
 */
export type WebKitImeInput = Readonly<{
    /** Every keydown, keypress and keyup xterm passes to its custom key handler; false: xterm must not handle it. */
    onKey: (event: KeyboardEvent) => boolean;
    /** Every `input` event on xterm's textarea, after xterm's own handler. */
    onInput: (event: InputEvent) => void;
}>;

export function createWebKitImeInput(send: (data: string) => void): WebKitImeInput {
    /** Mirrors xterm's `_keyDownSeen`: set by every keydown, cleared by every keyup. */
    let keyDownSeen = false;
    let shiftHeld = false;
    /** xterm typed this keystroke in its keypress; the browser then inserts the same character. */
    let keypressSeen = false;
    /** A keyCode 229 keydown waits for the character the input method inserts after it. */
    let keyAwaitingText = false;
    /**
     * xterm's check after a keyCode 229 keydown has not run yet; it sends whatever lands in the textarea meanwhile.
     * xterm queues it right after this handler returns, so the flag drops one timer later, after that check.
     */
    let textareaCheckPending = false;
    /** The input method inserted a character before its key's keydown. */
    let insertedBeforeKeydown = false;
    /** This keystroke's keydown was cancelled because its character was already inserted. */
    let keystrokeInserted = false;

    return {
        onKey: (event) => {
            if (event.type === 'keyup') {
                keyDownSeen = false;
                keypressSeen = false;
                keyAwaitingText = false;
                insertedBeforeKeydown = false;
                keystrokeInserted = false;
                if (event.key === 'Shift') shiftHeld = false;
                return true;
            }
            if (event.type === 'keypress') {
                if (keystrokeInserted) return false;
                keypressSeen = true;
                return true;
            }
            if (event.type !== 'keydown') return true;
            keyDownSeen = true;
            keypressSeen = false;
            keystrokeInserted = false;
            if (event.key === 'Shift') {
                shiftHeld = true;
                return true;
            }
            if (event.keyCode === 229) {
                if (insertedBeforeKeydown) insertedBeforeKeydown = false;
                else keyAwaitingText = true;
                textareaCheckPending = true;
                setTimeout(() => {
                    setTimeout(() => {
                        textareaCheckPending = false;
                    }, 0);
                }, 0);
                return true;
            }
            if (insertedBeforeKeydown && typesCharacter(event)) {
                insertedBeforeKeydown = false;
                keystrokeInserted = true;
                // As xterm does for a key it types: no keypress or insertion of the key's own character follows.
                event.preventDefault();
                return false;
            }
            return true;
        },
        onInput: (event) => {
            if (event.inputType !== 'insertText' || !event.data || event.isComposing) return;
            if (keypressSeen) return;
            if (!keyAwaitingText && shiftHeld) insertedBeforeKeydown = true;
            keyAwaitingText = false;
            if (event.composed && keyDownSeen && !textareaCheckPending) send(event.data);
        },
    };
}

function typesCharacter(event: KeyboardEvent): boolean {
    return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}
