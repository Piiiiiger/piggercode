const STARTUP_RPC_METHODS = new Set(['initialize']);
const LONG_RUNNING_RPC_METHODS = new Set([
    // Starting a thread is side-effecting admission. A timeout cannot establish whether Codex
    // accepted it, and loaded starts can legitimately exceed the ordinary startup RPC budget.
    'thread/start',
    'thread/resume',
    'thread/fork',
    'conversation/fork',
    // A timeout cannot establish whether Codex accepted this side effect. Keep the
    // request lifecycle-owned so slow admission never becomes ambiguous delivery.
    // turn/start has one bounded escape instead: when Codex shows no sign of accepting the
    // prompt within readCodexAppServerTurnStartStallTimeoutMs, the runtime kills that
    // app-server (a dead process cannot accept later) and retries once on a fresh one.
    'turn/start',
    'turn/steer',
]);

function clampRpcTimeoutMs(rawValue: unknown, fallbackMs: number, maxMs: number): number {
    const raw = Number.parseInt(String(rawValue ?? ''), 10);
    const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallbackMs;
    return Math.max(250, Math.min(maxMs, configured));
}

export function readCodexAppServerRpcTimeoutMs(env?: NodeJS.ProcessEnv): number {
    // Catalog, control, and account reads share the session-control load profile. A 15s cutoff
    // caused healthy app-server requests to fail during contention, so keep the default generous
    // while retaining a bounded operator override for genuinely slow local providers.
    return clampRpcTimeoutMs(env?.PIGGERCODE_CODEX_APP_SERVER_RPC_TIMEOUT_MS, 60_000, 10 * 60_000);
}

export function readCodexAppServerStartupRpcTimeoutMs(env?: NodeJS.ProcessEnv, baseTimeoutMs?: number): number {
    const base = baseTimeoutMs ?? readCodexAppServerRpcTimeoutMs(env);
    const configured = clampRpcTimeoutMs(env?.PIGGERCODE_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS, 60_000, 120_000);
    return Math.max(base, configured);
}

export function readCodexAppServerResumeRecoveryTimeoutMs(env?: NodeJS.ProcessEnv): number {
    const startupTimeoutMs = readCodexAppServerStartupRpcTimeoutMs(env);
    const configured = clampRpcTimeoutMs(
        env?.PIGGERCODE_CODEX_APP_SERVER_RESUME_RECOVERY_TIMEOUT_MS,
        120_000,
        10 * 60_000,
    );
    return Math.max(startupTimeoutMs, configured);
}

export function readCodexAppServerRequestTimeoutMs(method: string, env?: NodeJS.ProcessEnv): number | null {
    if (LONG_RUNNING_RPC_METHODS.has(method)) {
        return null;
    }
    const baseTimeoutMs = readCodexAppServerRpcTimeoutMs(env);
    if (STARTUP_RPC_METHODS.has(method)) {
        return readCodexAppServerStartupRpcTimeoutMs(env, baseTimeoutMs);
    }
    return baseTimeoutMs;
}

/**
 * How long turn/start may go unanswered, with no sign that Codex accepted the prompt, before
 * the runtime treats the app-server as wedged. Codex can legitimately hold admission while
 * optional MCP servers get their startup grace (60s) and required ones their startup timeout
 * (60s), so the default leaves room for both plus margin.
 */
export function readCodexAppServerTurnStartStallTimeoutMs(env?: NodeJS.ProcessEnv): number {
    return clampRpcTimeoutMs(env?.PIGGERCODE_CODEX_APP_SERVER_TURN_START_STALL_TIMEOUT_MS, 180_000, 30 * 60_000);
}
