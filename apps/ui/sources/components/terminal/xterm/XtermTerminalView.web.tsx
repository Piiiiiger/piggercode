import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

import { resolveKeyboardPlatform } from '@/keyboard/runtime';

export type XtermTerminalHandle = Readonly<{
    write: (data: string) => void;
    clear: () => void;
    focus: () => void;
    hasSelection: () => boolean;
    getSelectionText: () => string;
}>;

export type XtermTerminalViewProps = Readonly<{
    onInput: (data: string) => void;
    onResize: (cols: number, rows: number) => void;
    onReady: (cols: number, rows: number) => void;
    /**
     * Uploads pasted images to the terminal's machine and answers the path of each upload. The paths are
     * then pasted like dropped files, which Claude Code and Codex attach as images. Without it, an image on
     * the clipboard is not handed to the terminal.
     */
    onPasteImages?: (images: readonly File[]) => Promise<readonly string[]>;
    /** False while the terminal is not connected: typing or pasting then would be lost, so the terminal takes none. */
    inputEnabled?: boolean;
    fontSize: number;
    testID?: string;
}>;

const DEFAULT_FONT_FAMILY =
    'Menlo, ui-monospace, SFMono-Regular, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const OUTPUT_PREVIEW_MAX_CHARS = 4096;

/** The image files on a paste's clipboard: a screenshot, or copied image files. */
function readClipboardImages(data: DataTransfer | null | undefined): File[] {
    const images: File[] = [];
    for (const item of Array.from(data?.items ?? [])) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) images.push(file);
    }
    return images;
}

/**
 * The clipboard read on request, for a paste key that brings no paste event of its own. Text only
 * when the browser does not allow reading images.
 */
async function readClipboardContents(): Promise<Readonly<{ images: File[]; text: string }>> {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard) return { images: [], text: '' };
    if (typeof clipboard.read === 'function') {
        try {
            const images: File[] = [];
            let text = '';
            for (const item of await clipboard.read()) {
                const imageType = item.types.find((type) => type.startsWith('image/'));
                if (imageType) {
                    images.push(new File([await item.getType(imageType)], 'image', { type: imageType }));
                } else if (!text && item.types.includes('text/plain')) {
                    text = await (await item.getType('text/plain')).text();
                }
            }
            return { images, text };
        } catch {
            // Reading everything was refused; text may still be allowed.
        }
    }
    const text = typeof clipboard.readText === 'function' ? await clipboard.readText().catch(() => '') : '';
    return { images: [], text };
}

/**
 * A path as a terminal types a dropped file: every character a shell reads specially is escaped, so a
 * shell, Claude Code and Codex all read it as one path. Letters outside ASCII stay as they are.
 */
function typedPath(path: string): string {
    return path.replace(/[^A-Za-z0-9_\-.,:/@%+=\u0080-\uffff]/g, (char) => `\\${char}`);
}

function disposeTerminalAfterPendingViewportSync(term: Terminal): void {
    if (typeof window === 'undefined') {
        term.dispose();
        return;
    }

    // xterm 5.5 queues an untracked Viewport.syncScrollArea timer during open.
    // Keep this boundary delay until xterm cancels that timer during disposal.
    window.setTimeout(() => term.dispose(), 0);
}

export const XtermTerminalView = React.forwardRef<XtermTerminalHandle, XtermTerminalViewProps>(function XtermTerminalView(
    props,
    ref,
) {
    const { theme } = useUnistyles();
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const terminalRef = React.useRef<Terminal | null>(null);
    const fitAddonRef = React.useRef<FitAddon | null>(null);
    const resizeTimeoutRef = React.useRef<number | null>(null);
    const didReportReadyRef = React.useRef(false);
    const lastReportedSizeRef = React.useRef<{ cols: number; rows: number } | null>(null);

    const onInputRef = React.useRef(props.onInput);
    const onResizeRef = React.useRef(props.onResize);
    const onReadyRef = React.useRef(props.onReady);
    const onPasteImagesRef = React.useRef(props.onPasteImages);
    const inputEnabledRef = React.useRef(props.inputEnabled !== false);
    onInputRef.current = props.onInput;
    onResizeRef.current = props.onResize;
    onReadyRef.current = props.onReady;
    onPasteImagesRef.current = props.onPasteImages;
    inputEnabledRef.current = props.inputEnabled !== false;

    const pendingWriteRef = React.useRef('');
    const writeRafRef = React.useRef<number | null>(null);
    const isWritingRef = React.useRef(false);

    const outputPreviewRef = React.useRef('');
    const outputPreviewDirtyRef = React.useRef(false);

    const resetWriteState = React.useCallback(() => {
        pendingWriteRef.current = '';
        outputPreviewRef.current = '';
        outputPreviewDirtyRef.current = false;
        if (containerRef.current) {
            containerRef.current.removeAttribute('data-happier-terminal-text');
        }
        if (writeRafRef.current !== null && typeof window !== 'undefined') {
            window.cancelAnimationFrame(writeRafRef.current);
        }
        writeRafRef.current = null;
        isWritingRef.current = false;
    }, []);

    const applyOutputPreviewAttribute = React.useCallback(() => {
        if (!outputPreviewDirtyRef.current) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }
        outputPreviewDirtyRef.current = false;
        container.setAttribute('data-happier-terminal-text', outputPreviewRef.current);
    }, []);

    const flushWrites = React.useCallback(() => {
        if (isWritingRef.current) {
            return;
        }
        const term = terminalRef.current;
        if (!term) {
            return;
        }
        if (!pendingWriteRef.current) {
            return;
        }

        const chunk = pendingWriteRef.current;
        pendingWriteRef.current = '';

        isWritingRef.current = true;
        term.write(chunk, () => {
            isWritingRef.current = false;
            if (!pendingWriteRef.current) {
                return;
            }
            if (typeof window !== 'undefined') {
                writeRafRef.current = window.requestAnimationFrame(() => {
                    writeRafRef.current = null;
                    applyOutputPreviewAttribute();
                    flushWrites();
                });
            } else {
                applyOutputPreviewAttribute();
                flushWrites();
            }
        });
    }, [applyOutputPreviewAttribute]);

    const scheduleFlushWrites = React.useCallback(() => {
        if (writeRafRef.current !== null) {
            return;
        }
        if (typeof window !== 'undefined') {
            writeRafRef.current = window.requestAnimationFrame(() => {
                writeRafRef.current = null;
                applyOutputPreviewAttribute();
                flushWrites();
            });
        } else {
            applyOutputPreviewAttribute();
            flushWrites();
        }
    }, [applyOutputPreviewAttribute, flushWrites]);

    const enqueueWrite = React.useCallback((data: string) => {
        if (!data) {
            return;
        }
        pendingWriteRef.current += data;
        const nextPreview = outputPreviewRef.current + data;
        outputPreviewRef.current =
            nextPreview.length > OUTPUT_PREVIEW_MAX_CHARS
                ? nextPreview.slice(nextPreview.length - OUTPUT_PREVIEW_MAX_CHARS)
                : nextPreview;
        outputPreviewDirtyRef.current = true;
        scheduleFlushWrites();
    }, [scheduleFlushWrites]);

    // Pasted images go to the machine first; their paths then go in as pastes, one per image.
    const pasteImages = React.useCallback(async (images: readonly File[]) => {
        const upload = onPasteImagesRef.current;
        if (!upload || images.length === 0 || !inputEnabledRef.current) return;
        const paths = await upload(images);
        const term = terminalRef.current;
        if (!term || !inputEnabledRef.current) return;
        for (const path of paths) {
            term.paste(typedPath(path));
        }
    }, []);

    const pasteFromClipboard = React.useCallback(async () => {
        if (!inputEnabledRef.current) return;
        const { images, text } = await readClipboardContents();
        if (images.length > 0 && onPasteImagesRef.current) {
            await pasteImages(images);
            return;
        }
        if (text) {
            terminalRef.current?.paste(text);
        }
    }, [pasteImages]);

    const reportSize = React.useCallback((cols: number, rows: number, kind: 'ready' | 'resize') => {
        const previous = lastReportedSizeRef.current;
        if (!previous || previous.cols !== cols || previous.rows !== rows) {
            lastReportedSizeRef.current = { cols, rows };
            onResizeRef.current(cols, rows);
        }
        if (kind === 'ready' && !didReportReadyRef.current) {
            didReportReadyRef.current = true;
            onReadyRef.current(cols, rows);
        }
    }, []);

    const fitTerminal = React.useCallback((kind: 'ready' | 'resize') => {
        const fitAddon = fitAddonRef.current;
        const term = terminalRef.current;
        const container = containerRef.current;
        if (!fitAddon || !term || !container) {
            return;
        }

        const rect = container.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24) {
            return;
        }

        try {
            fitAddon.fit();
            reportSize(term.cols, term.rows, kind);
        } catch {
            // ignored
        }
    }, [reportSize]);

    React.useImperativeHandle(ref, () => ({
        write: enqueueWrite,
        clear: () => {
            const term = terminalRef.current;
            if (!term) {
                resetWriteState();
                return;
            }
            resetWriteState();
            term.clear();
            term.write('\x1b[2J\x1b[H');
        },
        focus: () => terminalRef.current?.focus(),
        hasSelection: () => terminalRef.current?.hasSelection() ?? false,
        getSelectionText: () => terminalRef.current?.getSelection() ?? '',
    }), [enqueueWrite, resetWriteState]);

    React.useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: DEFAULT_FONT_FAMILY,
            fontSize: Math.max(8, Math.round(props.fontSize)),
            scrollback: 5000,
            screenReaderMode: false,
            disableStdin: !inputEnabledRef.current,
            theme: {
                background: theme.colors.surface.base,
                foreground: theme.colors.text.primary,
                cursor: theme.colors.text.primary,
                selectionBackground: theme.colors.surface.selected,
            },
        });
        terminalRef.current = term;

        const fitAddon = new FitAddon();
        fitAddonRef.current = fitAddon;
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        try {
            term.loadAddon(new WebglAddon());
        } catch {
            // WebGL renderer unavailable; fall back to canvas.
        }

        term.open(container);

        term.attachCustomKeyEventHandler((event) => {
            if (event.type !== 'keydown') {
                return true;
            }

            const key = String((event as KeyboardEvent).key ?? '').toLowerCase();
            const isCopy = (event.ctrlKey || event.metaKey) && key === 'c';
            const isMac = resolveKeyboardPlatform() === 'macos';
            const isPasteKey = key === 'v' && !event.altKey;

            if (isCopy && term.hasSelection()) {
                event.preventDefault();
                event.stopPropagation();

                const selection = term.getSelection();
                if (selection && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(selection).catch(() => {});
                } else if (typeof document !== 'undefined') {
                    try {
                        document.execCommand('copy');
                    } catch {
                        // ignored
                    }
                }

                return false;
            }

            if (isPasteKey && (isMac ? event.metaKey : event.ctrlKey)) {
                // The browser pastes (see the paste listener): its paste carries images as well as text.
                return false;
            }

            if (isPasteKey && isMac && event.ctrlKey && !event.metaKey) {
                // Ctrl+V is Claude Code's image paste on a Mac. No browser paste comes with it, so read the clipboard.
                event.preventDefault();
                event.stopPropagation();
                void pasteFromClipboard();
                return false;
            }

            return true;
        });

        const dataDisposable = term.onData((data) => {
            onInputRef.current(data);
        });

        // Ahead of xterm (capture), which would paste only the clipboard's text.
        const onPaste = (event: ClipboardEvent) => {
            // Input off (not connected): xterm takes no paste either.
            if (!onPasteImagesRef.current || !inputEnabledRef.current) return;
            const images = readClipboardImages(event.clipboardData);
            if (images.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            void pasteImages(images);
        };
        container.addEventListener('paste', onPaste, true);

        const initTimer = typeof window !== 'undefined'
            ? window.setTimeout(() => {
                fitTerminal('ready');
                term.focus();
                scheduleFlushWrites();
            }, 20)
            : null;

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => {
                if (resizeTimeoutRef.current !== null && typeof window !== 'undefined') {
                    window.clearTimeout(resizeTimeoutRef.current);
                }
                resizeTimeoutRef.current = typeof window !== 'undefined'
                    ? window.setTimeout(() => {
                        resizeTimeoutRef.current = null;
                        fitTerminal('resize');
                    }, 80)
                    : null;
            })
            : null;

        resizeObserver?.observe(container);

        return () => {
            dataDisposable.dispose();
            container.removeEventListener('paste', onPaste, true);

            if (initTimer !== null && typeof window !== 'undefined') {
                window.clearTimeout(initTimer);
            }
            if (resizeTimeoutRef.current !== null && typeof window !== 'undefined') {
                window.clearTimeout(resizeTimeoutRef.current);
                resizeTimeoutRef.current = null;
            }

            resizeObserver?.disconnect();

            terminalRef.current = null;
            fitAddonRef.current = null;
            didReportReadyRef.current = false;
            lastReportedSizeRef.current = null;
            resetWriteState();
            disposeTerminalAfterPendingViewportSync(term);
        };
    }, [fitTerminal, pasteFromClipboard, pasteImages, props.fontSize, resetWriteState, scheduleFlushWrites, theme.colors.surface.base, theme.colors.surface.selected, theme.colors.text.primary]);

    React.useEffect(() => {
        const term = terminalRef.current;
        if (!term) {
            return;
        }

        try {
            term.options.fontSize = Math.max(8, Math.round(props.fontSize));
            term.options.theme = {
                background: theme.colors.surface.base,
                foreground: theme.colors.text.primary,
                cursor: theme.colors.text.primary,
                selectionBackground: theme.colors.surface.selected,
            };
        } catch {
            // ignored
        }

        fitTerminal('resize');
    }, [fitTerminal, props.fontSize, theme.colors.surface.base, theme.colors.surface.selected, theme.colors.text.primary]);

    const inputEnabled = props.inputEnabled !== false;
    React.useEffect(() => {
        const term = terminalRef.current;
        if (term) term.options.disableStdin = !inputEnabled;
    }, [inputEnabled]);

    return (
        <div
            ref={containerRef}
            data-testid={props.testID}
            onMouseDownCapture={(event) => {
                if (event.button !== 0) {
                    return;
                }
                terminalRef.current?.focus();
            }}
            style={{
                width: '100%',
                height: '100%',
                minHeight: 0,
                minWidth: 0,
                overflow: 'hidden',
            }}
        />
    );
});
