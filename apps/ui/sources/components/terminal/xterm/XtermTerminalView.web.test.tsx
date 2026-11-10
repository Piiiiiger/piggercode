/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fitSpy = vi.fn();
const focusSpy = vi.fn();
const loadAddonSpy = vi.fn();
const openSpy = vi.fn();
const attachCustomKeyEventHandlerSpy = vi.fn();
const onDataSpy = vi.fn();
const disposeSpy = vi.fn();
const pasteSpy = vi.fn();
const viewportTimerObservedDisposedSpy = vi.fn();
const terminalConstructorOptions: Record<string, unknown>[] = [];
const terminalInstances: MockTerminal[] = [];
let selectionText = '';
const registerOscHandlerSpy = vi.fn((_code: number, _handler: (data: string) => boolean) => ({ dispose: vi.fn() }));
// The browser clipboard (navigator.clipboard, absent in jsdom) is the boundary.
const writeTextSpy = vi.fn(async (_text: string) => {});
const readTextSpy = vi.fn(async () => 'this computer\'s clipboard');

const utf8Base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const osc52Handler = () => registerOscHandlerSpy.mock.calls.find(([code]) => code === 52)?.[1];
const copyKey = (overrides: Partial<KeyboardEvent> = {}) => ({
    type: 'keydown', key: 'c', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides,
}) as unknown as KeyboardEvent;

class MockTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    disposed = false;

    /**
     * The two input modes a program can leave on (xterm's `modes`): any-motion mouse reporting and focus reporting.
     * As in xterm, DECSET/DECRST set them, a full reset (RIS, `ESC c`, or `reset()`) clears them, and erasing the
     * screen leaves them. With `deferWrites`, written data waits for `flush()`, as in xterm's own write queue.
     */
    modes = { mouseTrackingMode: 'none' as 'none' | 'any', sendFocusMode: false };
    deferWrites = false;
    private queued: string[] = [];

    constructor(options: Record<string, unknown> = {}) {
        this.options = options;
        terminalConstructorOptions.push(options);
        terminalInstances.push(this);
        // xterm 5.5's Viewport constructor queues an untracked syncScrollArea
        // timer. Model that third-party lifecycle boundary here.
        setTimeout(() => viewportTimerObservedDisposedSpy(this.disposed), 0);
    }

    loadAddon = loadAddonSpy;
    open = openSpy;
    focus = focusSpy;
    clear = vi.fn();
    hasSelection = vi.fn(() => selectionText.length > 0);
    getSelection = vi.fn(() => selectionText);
    attachCustomKeyEventHandler = attachCustomKeyEventHandlerSpy;
    textarea = document.createElement('textarea');
    input = vi.fn();
    parser = { registerOscHandler: registerOscHandlerSpy };
    write = vi.fn((data: string, callback?: () => void) => {
        if (this.deferWrites) this.queued.push(data);
        else this.parse(data);
        callback?.();
    });
    flush() {
        for (const data of this.queued.splice(0)) this.parse(data);
    }
    private parse(data: string) {
        for (const [sequence, mode, flag] of data.matchAll(/\x1bc|\x1b\[\?(\d+)([hl])/g)) {
            if (sequence === '\x1bc') this.modes = { mouseTrackingMode: 'none', sendFocusMode: false };
            if (mode === '1003') this.modes.mouseTrackingMode = flag === 'h' ? 'any' : 'none';
            if (mode === '1004') this.modes.sendFocusMode = flag === 'h';
        }
    }
    reset = vi.fn(() => {
        this.modes = { mouseTrackingMode: 'none', sendFocusMode: false };
    });
    paste = pasteSpy;
    dispose = () => {
        this.disposed = true;
        disposeSpy();
    };

    onData(callback: (data: string) => void) {
        onDataSpy.mockImplementation(callback);
        return { dispose: vi.fn() };
    }
}

vi.mock('@xterm/xterm', () => ({
    Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: class {
        fit = fitSpy;
    },
}));

vi.mock('@xterm/addon-web-links', () => ({
    WebLinksAddon: class {},
}));

vi.mock('@xterm/addon-webgl', () => ({
    WebglAddon: class {},
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                surface: '#000000',
                surfaceSelected: '#333333',
                text: '#ffffff',
            },
        },
    });
});

describe('XtermTerminalView.web', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        fitSpy.mockReset();
        focusSpy.mockReset();
        loadAddonSpy.mockReset();
        openSpy.mockReset();
        attachCustomKeyEventHandlerSpy.mockReset();
        onDataSpy.mockReset();
        disposeSpy.mockReset();
        pasteSpy.mockReset();
        viewportTimerObservedDisposedSpy.mockReset();
        terminalConstructorOptions.length = 0;
        terminalInstances.length = 0;
        registerOscHandlerSpy.mockClear();
        selectionText = '';
        writeTextSpy.mockReset().mockResolvedValue(undefined);
        readTextSpy.mockClear();
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: writeTextSpy, readText: readTextSpy } });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        if (vi.isFakeTimers()) {
            await vi.runAllTimersAsync();
        } else {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        container.remove();
        vi.useRealTimers();
        delete (navigator as { clipboard?: unknown }).clipboard;
    });

    it('refocuses the terminal when the web container receives mouse down', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');

        await act(async () => {
            root.render(
                <XtermTerminalView
                    testID="terminal"
                    fontSize={14}
                    onInput={() => {}}
                    onResize={() => {}}
                    onReady={() => {}}
                />,
            );
        });

        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 40);
            });
        });

        const terminalContainer = container.querySelector('[data-testid="terminal"]');
        expect(terminalContainer).not.toBeNull();
        const initialFocusCalls = focusSpy.mock.calls.length;
        expect(initialFocusCalls).toBeGreaterThan(0);

        await act(async () => {
            terminalContainer!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        });

        expect(focusSpy.mock.calls.length).toBe(initialFocusCalls + 1);
    });

    it('opts out of xterm screen reader DOM mode in the web surface', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');

        await act(async () => {
            root.render(
                <XtermTerminalView
                    testID="terminal"
                    fontSize={14}
                    onInput={() => {}}
                    onResize={() => {}}
                    onReady={() => {}}
                />,
            );
        });

        expect(terminalConstructorOptions[0]).toEqual(
            expect.objectContaining({ screenReaderMode: false }),
        );
    });

    it('lets xterm viewport timers settle before disposing the terminal', async () => {
        vi.useFakeTimers();
        const { XtermTerminalView } = await import('./XtermTerminalView.web');

        await act(async () => {
            root.render(
                <XtermTerminalView
                    testID="terminal"
                    fontSize={14}
                    onInput={() => {}}
                    onResize={() => {}}
                    onReady={() => {}}
                />,
            );
        });

        await act(async () => {
            root.render(<></>);
        });

        expect(disposeSpy).not.toHaveBeenCalled();

        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(viewportTimerObservedDisposedSpy).toHaveBeenCalledWith(false);
        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
    it('copies onto this computer what a program in the terminal copies (Claude Code and Codex through tmux, or tmux itself)', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });

        const handler = osc52Handler();
        expect(handler).toBeTypeOf('function');
        expect(handler!(`c;${utf8Base64('终端里的文字 ✓')}`)).toBe(true);
        // tmux names no clipboard: `ESC ] 52 ; ; <base64>`.
        expect(handler!(`;${utf8Base64('tmux selection')}`)).toBe(true);
        await act(async () => {});

        expect(writeTextSpy.mock.calls.map(([text]) => text)).toEqual(['终端里的文字 ✓', 'tmux selection']);
    });

    it('never hands this computer\'s clipboard to a program that asks for it', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });

        const handler = osc52Handler();
        expect(handler).toBeTypeOf('function');
        expect(handler!('c;?')).toBe(true);
        await act(async () => {});

        expect(readTextSpy).not.toHaveBeenCalled();
        expect(writeTextSpy).not.toHaveBeenCalled();
    });

    it('writes a copy the browser refused on the next copy key, and leaves plain Ctrl+C to the program', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });
        // WebKit outside a key press or click.
        writeTextSpy.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'));

        const handler = osc52Handler();
        expect(handler).toBeTypeOf('function');
        handler!(`c;${utf8Base64('copied in Claude')}`);
        await act(async () => {});
        expect(writeTextSpy).toHaveBeenCalledTimes(1);

        const keyHandler = attachCustomKeyEventHandlerSpy.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
        // Ctrl+C with nothing selected interrupts the program.
        expect(keyHandler(copyKey({ metaKey: false, ctrlKey: true }))).toBe(true);
        expect(writeTextSpy).toHaveBeenCalledTimes(1);

        const event = copyKey();
        expect(keyHandler(event)).toBe(false);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(writeTextSpy.mock.calls.map(([text]) => text)).toEqual(['copied in Claude', 'copied in Claude']);
    });

    it('copies the terminal\'s own selection on the copy key', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });
        const keyHandler = attachCustomKeyEventHandlerSpy.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
        selectionText = 'selected text';
        expect(keyHandler(copyKey())).toBe(false);

        expect(writeTextSpy).toHaveBeenCalledWith('selected text');
    });

    it('starts a new stream with no mouse or focus reporting left on, after the output xterm still has queued', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        const ref = React.createRef<import('./XtermTerminalView.web').XtermTerminalHandle>();
        await act(async () => {
            root.render(<XtermTerminalView ref={ref} fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });
        const term = terminalInstances[0]!;
        // tmux turns these on for Claude Code. A re-attach starts a new stream before tmux runs again, and a terminal
        // still reporting would send every mouse move to it as typed text; some of the old output may still be queued.
        term.deferWrites = true;
        term.write('\x1b[?1003h\x1b[?1004h');

        act(() => ref.current!.reset());
        term.flush();

        expect(term.modes).toEqual({ mouseTrackingMode: 'none', sendFocusMode: false });
    });

    it('keeps the program\'s mouse and focus reporting when the screen is only cleared', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        const ref = React.createRef<import('./XtermTerminalView.web').XtermTerminalHandle>();
        await act(async () => {
            root.render(<XtermTerminalView ref={ref} fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });
        const term = terminalInstances[0]!;
        term.write('\x1b[?1003h\x1b[?1004h');

        // The pane's Clear button: tmux keeps running and still expects the modes it turned on.
        act(() => ref.current!.clear());

        expect(term.modes).toEqual({ mouseTrackingMode: 'any', sendFocusMode: true });
    });

    it('drops a refused program copy once the user copies their own selection', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });
        writeTextSpy.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'));
        osc52Handler()!(`c;${utf8Base64('older program copy')}`);
        await act(async () => {});

        const keyHandler = attachCustomKeyEventHandlerSpy.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
        selectionText = 'my selection';
        expect(keyHandler(copyKey())).toBe(false);
        selectionText = '';
        keyHandler(copyKey());

        expect(writeTextSpy.mock.calls.map(([text]) => text)).toEqual(['older program copy', 'my selection']);
    });

    it('types the "(" of Shift+9 that WebKit\'s input method delivers before the key, not the key\'s own "9"', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });
        const term = terminalInstances[0]!;
        const keyHandler = attachCustomKeyEventHandlerSpy.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;

        keyHandler(copyKey({ key: 'Shift', keyCode: 16, shiftKey: true, metaKey: false }));
        term.textarea.dispatchEvent(new InputEvent('input', { data: '(', inputType: 'insertText', composed: true }));
        const nine = copyKey({ key: '9', keyCode: 57, shiftKey: true, metaKey: false });

        expect(keyHandler(nine)).toBe(false);
        expect(nine.preventDefault).toHaveBeenCalled();
        expect(term.input).toHaveBeenCalledWith('(', true);
    });

    it('lets the browser paste on the paste shortcut, so pasted images reach the page', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        await act(async () => {
            root.render(<XtermTerminalView fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} />);
        });

        const keyHandler = attachCustomKeyEventHandlerSpy.mock.calls[0]![0] as (event: KeyboardEvent) => boolean;
        const preventDefault = vi.fn();
        const handled = keyHandler({ type: 'keydown', key: 'v', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault, stopPropagation: vi.fn() } as unknown as KeyboardEvent);

        // xterm leaves the key alone and the browser's own paste runs.
        expect(handled).toBe(false);
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('pastes a copied image as the path of its upload on the machine', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        const onPasteImages = vi.fn(async (_images: readonly File[]) => ["/home/me/Shots (Mac) it's/paste one.png"]);
        await act(async () => {
            root.render(
                <XtermTerminalView testID="terminal" fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} onPasteImages={onPasteImages} />,
            );
        });

        const image = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', {
            value: {
                items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
                getData: () => '',
            },
        });
        await act(async () => {
            container.querySelector('[data-testid="terminal"]')!.dispatchEvent(paste);
            // The upload answers asynchronously.
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(paste.defaultPrevented).toBe(true);
        expect(onPasteImages).toHaveBeenCalledWith([image]);
        // Typed like a dropped file, so Claude Code and Codex attach it as an image.
        expect(pasteSpy.mock.calls).toEqual([["/home/me/Shots\\ \\(Mac\\)\\ it\\'s/paste\\ one.png"]]);
    });
    it('takes no typing or pasting while the terminal is not connected, and takes it again once it is', async () => {
        const { XtermTerminalView } = await import('./XtermTerminalView.web');
        const onPasteImages = vi.fn(async (_images: readonly File[]) => ['/home/me/Downloads/paste.png']);
        const view = (inputEnabled: boolean) => (
            <XtermTerminalView testID="terminal" fontSize={14} onInput={() => {}} onResize={() => {}} onReady={() => {}} onPasteImages={onPasteImages} inputEnabled={inputEnabled} />
        );
        await act(async () => {
            root.render(view(false));
        });
        expect(terminalConstructorOptions[0]).toEqual(expect.objectContaining({ disableStdin: true }));

        const image = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', {
            value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }], getData: () => '' },
        });
        await act(async () => {
            container.querySelector('[data-testid="terminal"]')!.dispatchEvent(paste);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(onPasteImages).not.toHaveBeenCalled();

        await act(async () => {
            root.render(view(true));
        });
        expect(terminalConstructorOptions[0]?.disableStdin).toBe(false);
    });
});
