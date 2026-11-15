import { log } from '@/log';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { runtimeFetchWithServerReachability } from '@/sync/runtime/connectivity/serverReachabilityRuntimeFetch';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { resolveServerScopedSessionContext } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedSessionContext';

async function postSessionTerminalInput(sessionId: string): Promise<void> {
    const context = await resolveServerScopedSessionContext({
        serverId: resolvePreferredServerIdForSessionId(sessionId) ?? null,
    });
    const path = `/v2/sessions/${encodeURIComponent(sessionId)}/terminal-input`;
    const headers = { 'Content-Type': 'application/json' };
    const body = '{}';
    // The whole request gets the server-scoped session request budget: one the relay never answers must
    // not hold the session's turn (and with it every later Enter) for good.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
        const response = context.scope === 'active'
            ? await apiSocket.request(path, { method: 'POST', headers, body, signal: controller.signal })
            : await runtimeFetchWithServerReachability({
                serverUrl: context.targetServerUrl,
                token: context.token,
                url: `${context.targetServerUrl}${path}`,
                init: {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${context.token}`, ...headers },
                    body,
                    signal: controller.signal,
                },
                timeoutMs: context.timeoutMs,
            });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } finally {
        clearTimeout(timer);
    }
}

/** Sessions whose request is on its way, and whether Enter was typed again meanwhile. */
const inFlight = new Map<string, { again: boolean }>();

/**
 * Tells the session's relay that the user typed into its terminal (Enter in a view of it). The relay
 * dates the session's latest activity to it on every device, as a sent chat message does, so the
 * 「最近」 box, the list's order and the row's time follow what the user uses, whatever the session's
 * runner reports. One request per session at a time: Enters typed while it is on its way send one
 * more after it. A relay that cannot record it (one older than the route, or out of reach) leaves the
 * session dated by its runner; the next Enter asks again.
 */
export function sessionRecordTerminalInput(sessionId: string): void {
    const pending = inFlight.get(sessionId);
    if (pending) {
        pending.again = true;
        return;
    }
    const entry = { again: false };
    inFlight.set(sessionId, entry);
    void (async () => {
        try {
            do {
                entry.again = false;
                await postSessionTerminalInput(sessionId);
            } while (entry.again);
        } catch (error) {
            log.log(`[terminal-input] Could not record typing in session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            inFlight.delete(sessionId);
        }
    })();
}
