import * as React from 'react';
import type { DaemonTerminalLaunchIntent } from '@piggercode/protocol';

import { createEmptyTerminalSurfaceState, readTerminalSurfaceState } from '@/components/sessions/terminal/terminalSurfaceStateCache';
import {
    isRecoverableTerminalRpcError,
    isRecoverableTerminalSessionErrorCode,
    resolveTerminalAutoRetryDelayMs,
    safeTimeoutClear,
    safeTimeoutSet,
    TERMINAL_AUTO_RETRY_MAX_ATTEMPTS,
} from '@/components/sessions/terminal/terminalRpcRecovery';
import {
    claimTerminalReaderLease,
    hasTerminalReaderLease,
    releaseTerminalReaderLease,
    subscribeTerminalReaderLeaseAvailability,
} from '@/components/sessions/terminal/terminalReaderLeaseRegistry';
import { useEmbeddedTerminalTransportHandlers } from '@/components/sessions/terminal/useEmbeddedTerminalTransportHandlers';
import { useTerminalSurfaceState } from '@/components/sessions/terminal/useTerminalSurfaceState';
import type { EmbeddedTerminalRendererHandle } from '@/components/sessions/terminal/embeddedTerminalRendererHandle';
import {
    machineTerminalClose,
    machineTerminalEnsure,
    machineTerminalRepaint,
    machineTerminalRestart,
    machineTerminalStreamRead,
} from '@/sync/ops/machineTerminal';
import { isSocketIoDisconnectedError } from '@/sync/runtime/socketIoAckTimeout';
import { isHostVisible, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';
import { readHostWindowFocus } from '@/utils/runtime/readHostWindowFocus';
import { log } from '@/log';
import { delay } from '@/utils/timing/time';

/**
 * How long the machine may hold a terminal read open waiting for output, so output (and the echo of
 * what is typed) arrives the moment it appears instead of at the next ask. Under the relay's 30 s limit.
 */
const TERMINAL_READ_WAIT_MS = 15_000;

/** Whether someone is looking at this device's view: the app in front and, where it has one, its window focused. */
function isViewInUse(): boolean {
    return isHostVisible() && readHostWindowFocus() !== false;
}

/** `reconnecting`: connecting again while the view still shows the terminal's screen (it stays in sight). */
export type TerminalStatus = 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'error' | 'exited';

export function useMachineTerminalSession(params: Readonly<{
    machineId: string | null;
    cwd: string | null;
    launch?: DaemonTerminalLaunchIntent | null;
    machineReachable?: boolean;
    machineRpcTargetAvailable?: boolean;
    terminalKey: string;
    terminalRef: React.MutableRefObject<EmbeddedTerminalRendererHandle | null>;
    initialCommand?: string | null;
    closeOnUnmount?: boolean;
    /** Whether this view's screen is the one shown in the app (not covered by another screen or surface). */
    viewFocused?: boolean;
}>) {
    const initialSurfaceState = React.useMemo(
        () => readTerminalSurfaceState(params.terminalKey) ?? createEmptyTerminalSurfaceState(),
        [params.terminalKey],
    );

    const [status, setStatus] = React.useState<TerminalStatus>('idle');
    const [error, setError] = React.useState<string | null>(null);

    const [connectionNonce, bumpConnectionNonce] = React.useReducer((x: number) => x + 1, 0);
    // An agent CLI attached through tmux draws a full screen (its view needs the output from the start), and
    // only its login links are worth a bar of their own: other links stay clickable in the screen itself.
    const isAgentTerminal = params.launch?.kind === 'session_attach';
    /** Whether the view shows this terminal's screen, so that connecting again keeps it in sight. */
    const screenShownRef = React.useRef(false);
    const restartRequestedRef = React.useRef(false);
    const autoRetryAttemptRef = React.useRef(0);
    const autoRetryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearNonceRef = React.useRef(0);
    const terminalReaderOwnerTokenRef = React.useRef(Symbol(params.terminalKey));
    const ignoreNextLeaseAvailabilityRef = React.useRef(false);

    const terminalIdRef = React.useRef<string | null>(initialSurfaceState.terminalId);
    const cursorRef = React.useRef(initialSurfaceState.cursor);
    const terminalRendererHandleRef = React.useRef<EmbeddedTerminalRendererHandle | null>(null);
    const {
        detectedUrl,
        clearTerminalOutput,
        hydrateTerminalRendererIfNeeded,
        isScreenWhole,
        replaceSurfaceState,
        setDetectedUrl,
        syncDetectedUrl,
        updateSurfaceState,
        writeTerminalOutput,
    } = useTerminalSurfaceState({
        terminalKey: params.terminalKey,
        terminalRef: params.terminalRef,
        terminalIdRef,
        cursorRef,
        terminalRendererHandleRef,
        clearNonceRef,
        wholeScreenOnly: isAgentTerminal,
    });
    const { initialTerminalSize, latestTerminalSizeRef, onInput, onResize, onReady } = useEmbeddedTerminalTransportHandlers({
        machineId: params.machineId,
        terminalIdRef,
    });

    const clearTerminal = React.useCallback(() => {
        clearTerminalOutput();
    }, [clearTerminalOutput]);

    const resetAutoRetryState = React.useCallback(() => {
        autoRetryAttemptRef.current = 0;
        safeTimeoutClear(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
    }, []);

    const scheduleAutoRetry = React.useCallback((options?: Readonly<{ whileOffline?: boolean }>) => {
        const nextAttempt = autoRetryAttemptRef.current + 1;
        // A dropped connection (this app offline, e.g. in the background) comes back by itself: keep trying at
        // the longest pause instead of giving up after the usual attempts.
        if (nextAttempt > TERMINAL_AUTO_RETRY_MAX_ATTEMPTS && options?.whileOffline !== true) {
            return false;
        }

        autoRetryAttemptRef.current = nextAttempt;
        safeTimeoutClear(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = safeTimeoutSet(() => {
            autoRetryTimeoutRef.current = null;
            bumpConnectionNonce();
        }, resolveTerminalAutoRetryDelayMs(nextAttempt));
        setError(null);
        setStatus(screenShownRef.current ? 'reconnecting' : 'connecting');
        return true;
    }, []);

    const requestRestart = React.useCallback(() => {
        // The screen is cleared and drawn again from a fresh attach.
        screenShownRef.current = false;
        resetAutoRetryState();
        restartRequestedRef.current = true;
        clearTerminalOutput();
        syncDetectedUrl(null);
        bumpConnectionNonce();
    }, [clearTerminalOutput, resetAutoRetryState, syncDetectedUrl]);

    const retryConnect = React.useCallback(() => {
        resetAutoRetryState();
        restartRequestedRef.current = false;
        bumpConnectionNonce();
    }, [resetAutoRetryState]);

    /**
     * The window of a full-screen program attached through tmux takes the size of the device whose view was last in
     * use (`window-size latest`). Typing, a click or a wheel turn tells tmux so; coming back to a device does not, and
     * its view keeps showing the window sized for the other one. So a view coming into use (opened on an attach that
     * already ran, its app back in front, its window focused) tells the machine: a repaint makes this device's tmux
     * client the latest, and the window takes its size again. Until the view reads a terminal, the claim waits.
     */
    const windowClaimPendingRef = React.useRef(true);
    const connectedTerminalIdRef = React.useRef<string | null>(null);
    const viewFocusedRef = React.useRef(params.viewFocused !== false);
    viewFocusedRef.current = params.viewFocused !== false;
    const viewInUseRef = React.useRef(false);
    const claimWindow = React.useCallback(() => {
        const machineId = params.machineId;
        const terminalId = connectedTerminalIdRef.current;
        if (!isAgentTerminal || !windowClaimPendingRef.current || !machineId || !terminalId) return;
        if (!viewFocusedRef.current || !isViewInUse()) return;
        windowClaimPendingRef.current = false;
        void machineTerminalRepaint(machineId, { terminalId }).then((answer) => {
            if (!answer.ok) log.log(`[terminal] ${params.terminalKey} could not take the window: ${answer.errorCode}`);
        }, (error: unknown) => {
            // Not delivered: the view's next connection asks again.
            windowClaimPendingRef.current = true;
            log.log(`[terminal] ${params.terminalKey} could not take the window: ${error instanceof Error ? error.message : 'terminal_error'}`);
        });
    }, [isAgentTerminal, params.machineId, params.terminalKey]);

    // Coming into use: the app back in front, its window focused, or this view's screen shown again over another one.
    const noteViewInUse = React.useCallback(() => {
        const nowInUse = viewFocusedRef.current && isViewInUse();
        if (nowInUse && !viewInUseRef.current) {
            windowClaimPendingRef.current = true;
            claimWindow();
        }
        viewInUseRef.current = nowInUse;
    }, [claimWindow]);

    React.useEffect(() => {
        if (!isAgentTerminal) return;
        viewInUseRef.current = viewFocusedRef.current && isViewInUse();
        return subscribeToRuntimeActiveChange(noteViewInUse, { includeWindowFocus: true });
    }, [isAgentTerminal, noteViewInUse]);

    React.useEffect(() => {
        if (!isAgentTerminal) return;
        noteViewInUse();
    }, [isAgentTerminal, noteViewInUse, params.viewFocused]);

    React.useEffect(() => {
        return () => {
            safeTimeoutClear(autoRetryTimeoutRef.current);
            autoRetryTimeoutRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        terminalReaderOwnerTokenRef.current = Symbol(params.terminalKey);
        screenShownRef.current = false;
        // Another terminal in this view: its window is this device's to take as well.
        windowClaimPendingRef.current = true;
    }, [params.terminalKey]);

    React.useEffect(() => {
        return subscribeTerminalReaderLeaseAvailability(params.terminalKey, () => {
            if (ignoreNextLeaseAvailabilityRef.current) {
                ignoreNextLeaseAvailabilityRef.current = false;
                return;
            }
            if (!hasTerminalReaderLease(params.terminalKey, terminalReaderOwnerTokenRef.current)) {
                bumpConnectionNonce();
            }
        });
    }, [params.terminalKey]);

    React.useEffect(() => {
        return () => {
            releaseTerminalReaderLease(params.terminalKey, terminalReaderOwnerTokenRef.current);
        };
    }, [params.terminalKey]);

    React.useEffect(() => {
        let canceled = false;
        let readerLeaseReleased = false;

        const releaseReaderLease = () => {
            if (readerLeaseReleased) {
                return;
            }
            readerLeaseReleased = true;
            ignoreNextLeaseAvailabilityRef.current = true;
            releaseTerminalReaderLease(params.terminalKey, terminalReaderOwnerTokenRef.current);
        };

        const failTerminalSession = (errorCode: string) => {
            connectedTerminalIdRef.current = null;
            releaseReaderLease();
            setStatus('error');
            setError(errorCode);
        };

        const exitTerminalSession = () => {
            connectedTerminalIdRef.current = null;
            releaseReaderLease();
            setStatus('exited');
            setError(null);
        };

        // A full-screen program's view that lacks the start of its output is drawn whole again in place: tmux sends
        // the whole screen (modes included) when told its window changed. Much quicker than attaching afresh, which
        // starts a new CLI. Answers where that output starts, or null when the machine cannot (an older CLI, or
        // another terminal host) and the caller attaches afresh instead.
        const repaintOnMachine = async (machineId: string, terminalId: string): Promise<number | null> => {
            const repainted = await machineTerminalRepaint(machineId, { terminalId })
                .catch((error: unknown) => ({ ok: false as const, errorCode: error instanceof Error ? error.message : 'terminal_error' }));
            if (!repainted.ok) {
                log.log(`[terminal] ${params.terminalKey} attaches afresh: no repaint (${repainted.errorCode})`);
                return null;
            }
            return repainted.cursor;
        };

        // The reading view: only once the machine has answered does it clear and read on from where the redrawn
        // screen starts (older output is skipped). Until then nothing changes, so a reconnect or a reopened view meets
        // the same incomplete screen or gap and asks again. False: it stopped here (canceled, or a fresh attach was
        // requested instead).
        const redrawAndReadOn = async (machineId: string, terminalId: string): Promise<boolean> => {
            const redrawnFrom = await repaintOnMachine(machineId, terminalId);
            if (canceled) return false;
            if (redrawnFrom === null) {
                requestRestart();
                return false;
            }
            clearTerminalOutput();
            cursorRef.current = redrawnFrom;
            updateSurfaceState((current) => ({ ...current, terminalId, cursor: redrawnFrom }));
            // The repaint made this device's client the latest: the window has its size.
            windowClaimPendingRef.current = false;
            return true;
        };

        const start = async () => {
            connectedTerminalIdRef.current = null;
            const previousTerminalId = terminalIdRef.current;
            const previousCursor = cursorRef.current;
            const cachedSurfaceState = readTerminalSurfaceState(params.terminalKey) ?? createEmptyTerminalSurfaceState();

            if (!claimTerminalReaderLease(params.terminalKey, terminalReaderOwnerTokenRef.current)) {
                terminalIdRef.current = cachedSurfaceState.terminalId;
                cursorRef.current = cachedSurfaceState.cursor;
                setError(null);
                screenShownRef.current = cachedSurfaceState.terminalId !== null;
                setStatus(cachedSurfaceState.terminalId ? 'connected' : 'connecting');
                hydrateTerminalRendererIfNeeded();
                // Another view reads this terminal. A full-screen program's screen this view could not be given
                // whole is drawn again (or, failing that, comes from a fresh attach): the reading view gets that
                // output, and it reaches both views.
                const size = latestTerminalSizeRef.current ?? initialTerminalSize;
                if (isAgentTerminal && !isScreenWhole() && params.machineId && params.launch && size) {
                    // The reading view reads on from where it is, and the redrawn screen reaches this view through
                    // the kept output; nothing is cleared, so a redraw lost on the way is asked for again next time.
                    if (cachedSurfaceState.terminalId && (await repaintOnMachine(params.machineId, cachedSurfaceState.terminalId)) !== null) {
                        return;
                    }
                    if (canceled) return;
                    const restarted = await machineTerminalRestart(params.machineId, {
                        terminalKey: params.terminalKey,
                        cols: size.cols,
                        rows: size.rows,
                        launch: params.launch,
                    }).catch((error: unknown) => ({ ok: false as const, errorCode: error instanceof Error ? error.message : 'terminal_error' }));
                    if (!restarted.ok) {
                        log.log(`[terminal] a second view of ${params.terminalKey} could not attach afresh: ${restarted.errorCode}`);
                    }
                }
                return;
            }

            setError(null);
            setStatus(screenShownRef.current ? 'reconnecting' : 'connecting');

            if (params.machineReachable === false) {
                // This app sees the machine as offline (often this app is the one reconnecting): wait for it
                // without calling it an error; the terminal connects again once the machine is back. Checked first:
                // an offline machine is no target for calls either, so it also arrives without a machine id.
                releaseReaderLease();
                setError('terminal_machine_waiting');
                return;
            }
            if (!params.machineId || (!params.cwd && !params.launch)) {
                failTerminalSession('terminal_missing_machine_target');
                return;
            }
            if (params.machineRpcTargetAvailable === false) {
                failTerminalSession('terminal_rpc_target_unavailable');
                return;
            }
            if (!initialTerminalSize) {
                setStatus('connecting');
                return;
            }

            const terminalSize = latestTerminalSizeRef.current ?? initialTerminalSize;

            const request = params.launch
                ? {
                    terminalKey: params.terminalKey,
                    cols: terminalSize.cols,
                    rows: terminalSize.rows,
                    launch: params.launch,
                }
                : {
                    terminalKey: params.terminalKey,
                    cwd: params.cwd!,
                    cols: terminalSize.cols,
                    rows: terminalSize.rows,
                    initialCommand: params.initialCommand ?? undefined,
                };
            const ensured = restartRequestedRef.current
                ? await machineTerminalRestart(params.machineId, request)
                : await machineTerminalEnsure(params.machineId, request);
            restartRequestedRef.current = false;

            if (canceled) return;
            if (ensured.ok && !ensured.reused) {
                // A new attach's client is already the latest: the window has this device's size.
                windowClaimPendingRef.current = false;
            }
            if (!ensured.ok) {
                if (isRecoverableTerminalSessionErrorCode(ensured.errorCode) && scheduleAutoRetry()) {
                    return;
                }
                failTerminalSession(ensured.errorCode);
                return;
            }
            resetAutoRetryState();

            const terminalIdChanged = ensured.terminalId !== previousTerminalId;
            const shouldPreserveReusedSurfaceState = ensured.reused
                && previousTerminalId === null
                && (previousCursor > 0 || cachedSurfaceState.output.length > 0);
            terminalIdRef.current = ensured.terminalId;
            if (terminalIdChanged && !shouldPreserveReusedSurfaceState) {
                cursorRef.current = 0;
                terminalRendererHandleRef.current = params.terminalRef.current;
                // A new stream: the previous attach's mouse and focus reporting must not carry over.
                params.terminalRef.current?.reset();
                replaceSurfaceState({
                    terminalId: ensured.terminalId,
                    cursor: 0,
                    output: '',
                    outputEnd: 0,
                    detectedUrl: null,
                });
                setDetectedUrl(null);
            } else {
                cursorRef.current = previousCursor;
                replaceSurfaceState({
                    ...cachedSurfaceState,
                    terminalId: ensured.terminalId,
                    cursor: previousCursor,
                });
                hydrateTerminalRendererIfNeeded();
                // A view that was given only the end of a full-screen program's output has it drawn whole again.
                if (isAgentTerminal && !isScreenWhole() && !(await redrawAndReadOn(params.machineId, ensured.terminalId))) {
                    return;
                }
            }
            screenShownRef.current = true;
            setStatus('connected');
            connectedTerminalIdRef.current = ensured.terminalId;
            claimWindow();

            let idleCount = 0;
            while (!canceled) {
                const terminalId = terminalIdRef.current;
                if (!terminalId) break;
                const readClearNonce = clearNonceRef.current;

                const read = await machineTerminalStreamRead(params.machineId, {
                    terminalId,
                    cursor: cursorRef.current,
                    waitMs: TERMINAL_READ_WAIT_MS,
                }, { timeoutMs: TERMINAL_READ_WAIT_MS + 10_000 });
                if (canceled) return;

                if (!read.ok) {
                    if (isRecoverableTerminalSessionErrorCode(read.errorCode) && scheduleAutoRetry()) {
                        return;
                    }
                    failTerminalSession(read.errorCode);
                    return;
                }

                const readOn = () => {
                    const priorCursor = cursorRef.current;
                    cursorRef.current = read.nextCursor;
                    if (read.nextCursor !== priorCursor) {
                        updateSurfaceState((current) => ({
                            ...current,
                            terminalId,
                            cursor: read.nextCursor,
                        }));
                    }
                };

                // Output that was on its way when the terminal was cleared is dropped. A read the machine
                // held open only got output after its wait began, so what arrived after Clear stays.
                if (readClearNonce !== clearNonceRef.current && read.waited !== true) {
                    readOn();
                    if (read.events.some((event) => event.t === 'exit') || read.done) {
                        exitTerminalSession();
                        return;
                    }
                    idleCount = 0;
                    continue;
                }

                // Output was dropped before this view read it: a full-screen program's screen can no longer be rebuilt
                // from it, so it is drawn whole again before anything of this read is shown (all of it is older). The
                // cursor stays before the gap until the machine answered, so a reconnect or a reopened view meets the
                // gap again instead of reading past it.
                if (isAgentTerminal && read.events.some((event) => event.t === 'gap')) {
                    if (!(await redrawAndReadOn(params.machineId, terminalId))) return;
                    idleCount = 0;
                    continue;
                }

                readOn();

                if (read.events.length === 0) {
                    // A machine that held the read open answers empty only once its wait ran out: ask again
                    // at once. An older one answers empty right away: pause between asks as before.
                    if (read.waited !== true) {
                        idleCount = Math.min(10, idleCount + 1);
                        await delay(Math.min(250, 60 + idleCount * 10));
                    }
                } else {
                    idleCount = 0;
                }

                let sawExit = false;
                for (const event of read.events) {
                    if (event.t === 'data') {
                        writeTerminalOutput(event.data);
                    } else if (event.t === 'gap') {
                        writeTerminalOutput('\r\n[Output truncated]\r\n');
                    } else if (event.t === 'url') {
                        if (!isAgentTerminal || event.kind === 'auth') {
                            syncDetectedUrl(event);
                        }
                    } else if (event.t === 'exit') {
                        sawExit = true;
                    }
                }

                if (sawExit || read.done) {
                    exitTerminalSession();
                    return;
                }
            }
        };

        void start().catch((e) => {
            if (canceled) return;
            if (isRecoverableTerminalRpcError(e) && scheduleAutoRetry({ whileOffline: isSocketIoDisconnectedError(e) })) {
                return;
            }
            failTerminalSession(e instanceof Error ? e.message : 'terminal_error');
        });

        return () => {
            canceled = true;
            connectedTerminalIdRef.current = null;
        };
    }, [
        claimWindow,
        connectionNonce,
        hydrateTerminalRendererIfNeeded,
        initialTerminalSize,
        latestTerminalSizeRef,
        params.cwd,
        params.initialCommand,
        params.launch,
        params.machineId,
        params.machineReachable,
        params.machineRpcTargetAvailable,
        params.terminalKey,
        params.terminalRef,
        isScreenWhole,
        replaceSurfaceState,
        requestRestart,
        resetAutoRetryState,
        scheduleAutoRetry,
        isAgentTerminal,
        setDetectedUrl,
        syncDetectedUrl,
        updateSurfaceState,
        writeTerminalOutput,
    ]);

    React.useEffect(() => {
        return () => {
            if (!params.closeOnUnmount || !params.machineId || !terminalIdRef.current) return;
            void machineTerminalClose(params.machineId, { terminalId: terminalIdRef.current });
        };
    }, [params.closeOnUnmount, params.machineId]);

    const dismissDetectedUrl = React.useCallback(() => {
        syncDetectedUrl(null);
    }, [syncDetectedUrl]);

    return {
        status,
        error,
        detectedUrl,
        onInput,
        onResize,
        onReady,
        clearTerminal,
        requestRestart,
        retryConnect,
        dismissDetectedUrl,
    } as const;
}
