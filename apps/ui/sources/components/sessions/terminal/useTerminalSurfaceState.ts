import * as React from 'react';

import type { DaemonTerminalStreamEventUrl } from '@piggercode/protocol';

import type { EmbeddedTerminalRendererHandle } from './embeddedTerminalRendererHandle';
import {
    createEmptyTerminalSurfaceState,
    readTerminalSurfaceState,
    replaceTerminalSurfaceState,
    subscribeTerminalSurfaceState,
    updateTerminalSurfaceState,
} from './terminalSurfaceStateCache';

export function useTerminalSurfaceState(params: Readonly<{
    terminalKey: string;
    terminalRef: React.MutableRefObject<EmbeddedTerminalRendererHandle | null>;
    terminalIdRef: React.MutableRefObject<string | null>;
    cursorRef: React.MutableRefObject<number>;
    terminalRendererHandleRef: React.MutableRefObject<EmbeddedTerminalRendererHandle | null>;
    clearNonceRef: React.MutableRefObject<number>;
    /**
     * A full-screen program (an agent CLI attached through tmux) draws its screen as updates to what it drew
     * before, so only its whole output rebuilds that screen: a view is never given just the end of it.
     */
    wholeScreenOnly?: boolean;
}>) {
    const initialSurfaceState = React.useMemo(
        () => readTerminalSurfaceState(params.terminalKey) ?? createEmptyTerminalSurfaceState(),
        [params.terminalKey],
    );
    const [detectedUrl, setDetectedUrl] = React.useState<DaemonTerminalStreamEventUrl | null>(initialSurfaceState.detectedUrl);
    /** How far into the terminal's output (counted like `outputEnd`) this view's renderer has been written. */
    const renderedEndRef = React.useRef(0);
    /** Whether this view's renderer shows the terminal's output from its start (nothing missing in between). */
    const screenWholeRef = React.useRef(true);
    const wholeScreenOnly = params.wholeScreenOnly === true;

    const updateSurfaceState = React.useCallback((updater: (current: ReturnType<typeof createEmptyTerminalSurfaceState>) => ReturnType<typeof createEmptyTerminalSurfaceState>) => {
        return updateTerminalSurfaceState(params.terminalKey, updater);
    }, [params.terminalKey]);

    const replaceSurfaceState = React.useCallback((nextState: ReturnType<typeof createEmptyTerminalSurfaceState>) => {
        return replaceTerminalSurfaceState(params.terminalKey, nextState);
    }, [params.terminalKey]);

    const syncDetectedUrl = React.useCallback((nextUrl: DaemonTerminalStreamEventUrl | null) => {
        setDetectedUrl(nextUrl);
        updateSurfaceState((current) => ({
            ...current,
            terminalId: params.terminalIdRef.current,
            cursor: params.cursorRef.current,
            detectedUrl: nextUrl,
        }));
    }, [params.cursorRef, params.terminalIdRef, updateSurfaceState]);

    const clearTerminalOutput = React.useCallback(() => {
        params.clearNonceRef.current += 1;
        const renderer = params.terminalRef.current;
        if (renderer) {
            params.terminalRendererHandleRef.current = renderer;
            renderer.clear();
        }
        renderedEndRef.current = 0;
        // Cleared together with the record: the view shows the output from its (new) start.
        screenWholeRef.current = true;
        updateSurfaceState((current) => ({
            ...current,
            terminalId: params.terminalIdRef.current,
            cursor: params.cursorRef.current,
            output: '',
            outputEnd: 0,
        }));
    }, [params.clearNonceRef, params.cursorRef, params.terminalIdRef, params.terminalRef, params.terminalRendererHandleRef, updateSurfaceState]);

    // Output goes into the record, and every other view of this terminal writes what it has not shown yet
    // (applySurfaceStateToRenderer). This view writes the output itself while it is in step with the record,
    // so a chunk longer than the record keeps still shows whole.
    const writeTerminalOutput = React.useCallback((data: string) => {
        if (!data) {
            return;
        }
        const renderer = params.terminalRef.current;
        const recordEnd = (readTerminalSurfaceState(params.terminalKey) ?? createEmptyTerminalSurfaceState()).outputEnd;
        if (renderer && params.terminalRendererHandleRef.current === renderer && renderedEndRef.current === recordEnd) {
            renderer.write(data);
            renderedEndRef.current += data.length;
        }
        updateSurfaceState((current) => ({
            ...current,
            terminalId: params.terminalIdRef.current,
            cursor: params.cursorRef.current,
            output: current.output + data,
            outputEnd: current.outputEnd + data.length,
        }));
    }, [params.cursorRef, params.terminalIdRef, params.terminalKey, params.terminalRef, params.terminalRendererHandleRef, updateSurfaceState]);

    const applySurfaceStateToRenderer = React.useCallback((state: ReturnType<typeof createEmptyTerminalSurfaceState>) => {
        const renderer = params.terminalRef.current;
        params.terminalIdRef.current = state.terminalId;
        params.cursorRef.current = state.cursor;
        setDetectedUrl(state.detectedUrl);

        if (!renderer) {
            renderedEndRef.current = state.outputEnd;
            return;
        }

        if (params.terminalRendererHandleRef.current !== renderer) {
            params.terminalRendererHandleRef.current = renderer;
            renderer.clear();
            renderedEndRef.current = 0;
            screenWholeRef.current = true;
        }

        const unseen = state.outputEnd - renderedEndRef.current;
        if (unseen === 0) {
            return;
        }
        if (unseen > 0 && unseen <= state.output.length) {
            renderer.write(state.output.slice(state.output.length - unseen));
        } else {
            // Cleared, or further behind than the kept output: show the kept output from the start, unless it
            // no longer reaches back to the start and the view draws a full-screen program.
            renderer.clear();
            const fromStart = state.outputEnd === state.output.length;
            if (state.output && (fromStart || !wholeScreenOnly)) {
                renderer.write(state.output);
            }
            screenWholeRef.current = fromStart;
        }
        renderedEndRef.current = state.outputEnd;
    }, [params.cursorRef, params.terminalIdRef, params.terminalRef, params.terminalRendererHandleRef, wholeScreenOnly]);

    /** Whether the view shows the terminal's output from its start; false after it was given only the end of it. */
    const isScreenWhole = React.useCallback(() => screenWholeRef.current, []);

    const hydrateTerminalRendererIfNeeded = React.useCallback(() => {
        const renderer = params.terminalRef.current;
        if (!renderer) {
            return;
        }
        if (params.terminalRendererHandleRef.current === renderer) {
            return;
        }

        applySurfaceStateToRenderer(readTerminalSurfaceState(params.terminalKey) ?? createEmptyTerminalSurfaceState());
    }, [applySurfaceStateToRenderer, params.terminalKey, params.terminalRef, params.terminalRendererHandleRef]);

    React.useEffect(() => {
        hydrateTerminalRendererIfNeeded();
    });

    React.useEffect(() => {
        return subscribeTerminalSurfaceState(params.terminalKey, (state) => {
            applySurfaceStateToRenderer(state);
        });
    }, [applySurfaceStateToRenderer, params.terminalKey]);

    React.useEffect(() => {
        const cached = readTerminalSurfaceState(params.terminalKey) ?? createEmptyTerminalSurfaceState();
        params.terminalIdRef.current = cached.terminalId;
        params.cursorRef.current = cached.cursor;
        params.terminalRendererHandleRef.current = null;
        renderedEndRef.current = 0;
        screenWholeRef.current = true;
        setDetectedUrl(cached.detectedUrl);
        params.terminalRef.current?.clear();
    }, [params.cursorRef, params.terminalIdRef, params.terminalKey, params.terminalRef, params.terminalRendererHandleRef]);

    return {
        initialSurfaceState,
        detectedUrl,
        updateSurfaceState,
        replaceSurfaceState,
        syncDetectedUrl,
        clearTerminalOutput,
        writeTerminalOutput,
        hydrateTerminalRendererIfNeeded,
        isScreenWhole,
        setDetectedUrl,
    } as const;
}
