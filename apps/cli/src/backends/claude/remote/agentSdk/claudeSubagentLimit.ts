import { isClaudeAsyncAgentLaunchToolResult } from '@piggercode/protocol';

// Claude Code has no setting for how many subagents may run at once, so the runner counts them
// from its own hooks and refuses a call that would go over the account's limit.
//
// A foreground subagent lives exactly as long as the Agent/Task call that started it, so it is
// counted as that pending call. A background subagent (an async launch, or a finished one that
// SendMessage resumed) is counted from its launch acknowledgement until it stops.
//
// Hooks cannot see everything, so two rare races can run one subagent over the limit for a
// while (it is still counted, so further launches wait): a message queued to a running subagent
// that resumes it after it stopped, and a stop that another hook vetoes after a new launch.

export const CLAUDE_SUBAGENT_LAUNCH_TOOL_NAMES = ['Agent', 'Task'] as const;
/** The tools the limit hook watches: SendMessage resumes a finished subagent in the background. */
export const CLAUDE_SUBAGENT_TOOL_NAMES = [...CLAUDE_SUBAGENT_LAUNCH_TOOL_NAMES, 'SendMessage'] as const;

const LAUNCH_TOOL_NAMES = new Set<string>(CLAUDE_SUBAGENT_LAUNCH_TOOL_NAMES);
// Last resort for a background subagent killed without a stop hook: forget it only after hours
// without any hook from inside it.
const BACKGROUND_SILENT_EXPIRY_MS = 2 * 60 * 60_000;
const STOPPED_MEMORY = 256;

function readRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAgentIdOf(value: unknown): string | null {
    const row = readRecord(value);
    return readString(row?.agentId) ?? readString(row?.agent_id) ?? readString(row?.taskId) ?? readString(row?.task_id);
}

function readAsyncLaunchAgentId(response: unknown): string | null {
    if (!isClaudeAsyncAgentLaunchToolResult(response)) return null;
    const row = readRecord(response);
    return readAgentIdOf(row) ?? readAgentIdOf(row?.tool_use_result) ?? readAgentIdOf(row?.toolUseResult);
}

function readResumedAgentId(response: unknown): string | null {
    const row = readRecord(response);
    if (!row || row.success === false || row.is_error === true || row.isError === true || row.error != null) return null;
    const status = readString(row.status)?.toLowerCase();
    if (status && ['failed', 'error', 'denied', 'rejected'].includes(status)) return null;
    return readString(row.resumedAgentId) ?? readString(row.resumed_agent_id);
}

function readUserStoppedAgentId(response: unknown, toolInput: unknown): string | null {
    const row = readRecord(response);
    if (row?.success !== false) return null;
    const agentId = /^Agent (\S+) was stopped by the user and won't be resumed\./.exec(readString(row.message) ?? '')?.[1];
    return agentId && readString(readRecord(toolInput)?.to) === agentId ? agentId : null;
}

export function describeClaudeSubagentLimitRefusal(limit: number, running: number): string {
    if (limit === 0) {
        return 'Subagents are turned off for this session in PiggerCode settings. Do this work directly instead.';
    }
    return `This session may run at most ${limit} subagent${limit === 1 ? '' : 's'} at a time (PiggerCode settings), `
        + `and ${running} ${running === 1 ? 'is' : 'are'} running. Wait for one to finish, or do this work directly.`;
}

export type ClaudeSubagentLimitTracker = Readonly<{
    /** Returns why this call is refused, or null after counting it. */
    admitToolUse: (call: Readonly<{ toolName: string | null; toolInput: unknown; toolUseId: string | null }>) => string | null;
    /** Feeds every SDK hook input, so tool results, starts and stops update the count. */
    observeHook: (input: Readonly<Record<string, unknown>>) => void;
    activeCount: () => number;
}>;

export function createClaudeSubagentLimitTracker(params: Readonly<{
    getLimit: () => number | null;
    nowMs?: () => number;
}>): ClaudeSubagentLimitTracker {
    const nowMs = params.nowMs ?? (() => Date.now());
    // Admitted calls whose tool call has not returned, by tool_use_id. A SendMessage call also
    // names the finished subagent it may resume.
    const pendingCalls = new Map<string, { admittedAtMs: number; resumeTarget: string | null; handedOver: boolean }>();
    // Detached subagents still running, by agent id -> last hook seen from it.
    const background = new Map<string, number>();
    // Recently stopped subagents: when they stopped and whether they ran in the background.
    const stopped = new Map<string, Readonly<{ atMs: number; wasBackground: boolean }>>();
    // Background subagents forgotten after a long silence. Kept apart from the bounded stopped
    // memory: they may still be alive, and any sign of life must count them again.
    const silentBackground = new Set<string>();
    let syntheticCallId = 0;

    const rememberStopped = (agentId: string, wasBackground: boolean): void => {
        stopped.delete(agentId);
        stopped.set(agentId, { atMs: nowMs(), wasBackground });
        if (stopped.size > STOPPED_MEMORY) {
            const oldest = stopped.keys().next();
            if (!oldest.done) stopped.delete(oldest.value);
        }
    };
    const activeCount = (): number => {
        const now = nowMs();
        for (const [agentId, lastSeenAt] of background) {
            if (now - lastSeenAt <= BACKGROUND_SILENT_EXPIRY_MS) continue;
            background.delete(agentId);
            silentBackground.add(agentId);
        }
        let counted = background.size;
        for (const call of pendingCalls.values()) {
            if (!call.handedOver) counted += 1;
        }
        return counted;
    };
    // A launch or resume acknowledgement can arrive after the subagent already stopped.
    const markBackgroundUnlessStoppedSince = (agentId: string, sinceMs: number): void => {
        const stop = stopped.get(agentId);
        if (stop && stop.atMs >= sinceMs) {
            // Already stopped: remember it ran in the background, in case that stop is vetoed.
            stopped.set(agentId, { atMs: stop.atMs, wasBackground: true });
            return;
        }
        stopped.delete(agentId);
        silentBackground.delete(agentId);
        background.set(agentId, nowMs());
    };

    return {
        admitToolUse: ({ toolName, toolInput, toolUseId }) => {
            if (toolName === 'SendMessage') {
                // Only a message to a subagent known to have finished resumes one. Messages to a
                // running subagent, to the main agent or by name stay free.
                const target = readString(readRecord(toolInput)?.to);
                if (!target || !stopped.has(target)) return null;
            } else if (!toolName || !LAUNCH_TOOL_NAMES.has(toolName)) {
                return null;
            }
            const active = activeCount();
            const limit = params.getLimit();
            if (limit !== null && active >= limit) {
                return describeClaudeSubagentLimitRefusal(limit, active);
            }
            pendingCalls.set(toolUseId ?? `call-${++syntheticCallId}`, {
                admittedAtMs: nowMs(),
                resumeTarget: toolName === 'SendMessage' ? readString(readRecord(toolInput)?.to) : null,
                handedOver: false,
            });
            return null;
        },
        observeHook: (input) => {
            const event = readString(input.hook_event_name) ?? readString(input.hookEventName);
            const agentId = readString(input.agent_id) ?? readString(input.agentId);
            if (event === 'SubagentStop') {
                if (!agentId) return;
                const wasBackground = background.delete(agentId);
                rememberStopped(agentId, silentBackground.delete(agentId) || wasBackground);
                return;
            }
            if (event === 'SubagentStart') {
                if (!agentId) return;
                const stop = stopped.get(agentId);
                stopped.delete(agentId);
                // A SendMessage resuming this subagent hands its slot over instead of counting twice.
                let resumedByMessage = false;
                for (const call of pendingCalls.values()) {
                    if (call.resumeTarget !== agentId || call.handedOver) continue;
                    call.handedOver = true;
                    resumedByMessage = true;
                    break;
                }
                // Started again after a stop as a background one (or by a message): a resume.
                if (resumedByMessage || stop?.wasBackground || silentBackground.delete(agentId)) {
                    background.set(agentId, nowMs());
                }
                return;
            }
            if (event === 'Stop' && !agentId) {
                // The main turn ended, so every call it made has returned.
                pendingCalls.clear();
                return;
            }
            if (agentId) {
                if (background.has(agentId)) {
                    background.set(agentId, nowMs());
                } else if (stopped.get(agentId)?.wasBackground || silentBackground.has(agentId)) {
                    // A vetoed stop, or a long silence that ended: the subagent kept working.
                    stopped.delete(agentId);
                    silentBackground.delete(agentId);
                    background.set(agentId, nowMs());
                }
            }
            if (event !== 'PostToolUse' && event !== 'PostToolUseFailure' && event !== 'PermissionDenied') return;
            const toolName = readString(input.tool_name) ?? readString(input.toolName);
            const toolUseId = readString(input.tool_use_id) ?? readString(input.toolUseId);
            const admittedAt = toolUseId ? pendingCalls.get(toolUseId)?.admittedAtMs : undefined;
            if (toolUseId) pendingCalls.delete(toolUseId);
            if (event !== 'PostToolUse') return;
            const toolInput = input.tool_input ?? input.toolInput;
            const response = input.tool_response ?? input.toolResponse;
            if (toolName && LAUNCH_TOOL_NAMES.has(toolName)) {
                const launchedAgentId = readAsyncLaunchAgentId(response);
                if (launchedAgentId) markBackgroundUnlessStoppedSince(launchedAgentId, admittedAt ?? 0);
            } else if (toolName === 'SendMessage') {
                const resumedAgentId = readResumedAgentId(response);
                if (resumedAgentId) markBackgroundUnlessStoppedSince(resumedAgentId, admittedAt ?? nowMs());
                const userStoppedAgentId = readUserStoppedAgentId(response, toolInput);
                if (userStoppedAgentId) background.delete(userStoppedAgentId);
            } else if (toolName === 'TaskStop') {
                const stoppedTaskId = readAgentIdOf(toolInput) ?? readString(readRecord(toolInput)?.shell_id);
                if (stoppedTaskId && background.delete(stoppedTaskId)) rememberStopped(stoppedTaskId, true);
            }
        },
        activeCount,
    };
}
