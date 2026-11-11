import { TerminalWaitingSchema, type TerminalWaiting } from '@/sync/domains/state/storageTypes';

function readTerminalWaiting(agentState: unknown): TerminalWaiting | null {
    const value = (agentState as { terminalWaiting?: unknown } | null | undefined)?.terminalWaiting;
    const parsed = TerminalWaitingSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

/**
 * What a 「终端」 session's terminal started waiting for in this update (a prompt, or a CLI that quit
 * with an error), or null when it waits for nothing new. A wait is new when it started after the one
 * the app already knew.
 */
export function deriveNewTerminalWait(previousAgentState: unknown, nextAgentState: unknown): TerminalWaiting | null {
    const next = readTerminalWaiting(nextAgentState);
    if (!next) return null;
    const previous = readTerminalWaiting(previousAgentState);
    if (previous && previous.on === next.on && previous.since === next.since) return null;
    return next;
}
