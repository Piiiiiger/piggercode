function formatStallDuration(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    if (seconds < 120) return `${Math.round(seconds)}s`;
    return `${Math.round(seconds / 60)} min`;
}

export class CodexAppServerTurnStartStalledError extends Error {
    readonly stalledAfterMs: number;

    constructor(stalledAfterMs: number) {
        super(`Codex app-server did not answer turn/start within ${formatStallDuration(stalledAfterMs)}`);
        this.name = 'CodexAppServerTurnStartStalledError';
        this.stalledAfterMs = stalledAfterMs;
    }
}

export function isCodexAppServerTurnStartStalledError(error: unknown): error is CodexAppServerTurnStartStalledError {
    return error instanceof CodexAppServerTurnStartStalledError;
}

/** What the session shows after a stalled turn/start was handled. */
export function describeCodexTurnStartStall(stalledAfterMs: number, appServerStopped: boolean): string {
    const waited = formatStallDuration(stalledAfterMs);
    return appServerStopped
        ? `Codex did not respond to this message for ${waited}, so PiggerCode restarted it. `
            + 'The message was not delivered; retry it from the queue.'
        : `Codex did not respond to this message for ${waited} and could not be stopped for sure. `
            + 'Check whether it arrived before you retry it.';
}

/**
 * Waits for a turn/start request to settle.
 *
 * If it has not settled after `stallTimeoutMs` and `hasAdmissionEvidence()` is false, this
 * rejects with CodexAppServerTurnStartStalledError. The caller must then kill the app-server, so
 * the abandoned request can never be accepted later. Once Codex has shown any sign of accepting
 * the prompt, a stall is no longer provably undelivered, so the request is awaited without a bound.
 */
export function awaitCodexTurnStartAdmission<T>(params: Readonly<{
    work: Promise<T>;
    stallTimeoutMs: number;
    hasAdmissionEvidence: () => boolean;
}>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled || params.hasAdmissionEvidence()) return;
            settled = true;
            // The abandoned request settles when the caller disposes its client.
            params.work.catch(() => undefined);
            reject(new CodexAppServerTurnStartStalledError(params.stallTimeoutMs));
        }, params.stallTimeoutMs);
        params.work.then((value) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            resolve(value);
        }, (error: unknown) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            reject(error);
        });
    });
}
