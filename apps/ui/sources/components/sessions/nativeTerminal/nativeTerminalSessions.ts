import { resolveAgentIdFromSessionMetadata, resolveVendorResumeIdFromSessionMetadata, type AgentId } from '@piggercode/agents';

import { agentSupportsNativeTerminalSessions, getAgentCore } from '@/agents/registry/registryCore';
import { machineRecordStartsNativeTerminalSessions } from '@/sync/domains/machines/readMachineDaemonCliVersionForServerScope';
import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import type { ResumeSessionOptions } from '@/sync/ops';

/**
 * Claude and Codex sessions are their own CLI in a terminal (「终端」). A machine whose PiggerCode
 * CLI cannot start terminal sessions keeps the older chat sessions, so it stays usable until updated.
 */
export function newSessionStartsTerminal(params: Readonly<{
    agentId: AgentId;
    machine: Machine | null | undefined;
    /** An automation is saved to run later as a chat, not started now. */
    automationEnabled: boolean;
    /** A replay-seeded session stays a chat: its seed is a chat transcript the CLI would not see. */
    sourceContext: boolean;
}>): boolean {
    return !params.automationEnabled
        && !params.sourceContext
        && agentSupportsNativeTerminalSessions(params.agentId)
        && machineRecordStartsNativeTerminalSessions(params.machine);
}

/**
 * Whether a session shows its CLI's terminal instead of the chat view: a 「终端」 session always, and
 * an older chat session once nothing runs it, because opening it again starts the terminal. A chat
 * that still runs stays a chat until it is switched over (`sessionCanSwitchToTerminal`).
 */
export function sessionShowsTerminal(params: Readonly<{
    session: Session;
    machine: Machine | null | undefined;
}>): boolean {
    if (params.session.metadata?.nativeTerminal === true) return true;
    return params.session.active !== true && chatSessionOpensAsTerminal(params);
}

/** A running Claude or Codex chat on a machine that can run it as a terminal instead. */
export function sessionCanSwitchToTerminal(params: Readonly<{
    session: Session;
    machine: Machine | null | undefined;
}>): boolean {
    if (params.session.metadata?.nativeTerminal === true) return false;
    return params.session.active === true && chatSessionOpensAsTerminal(params);
}

function chatSessionOpensAsTerminal(params: Readonly<{
    session: Session;
    machine: Machine | null | undefined;
}>): boolean {
    // A replay seed that has not reached a first prompt yet stays a chat: only the chat runtime
    // puts the earlier conversation in front of that prompt, and the CLI would never see it.
    const replaySeed = params.session.metadata?.replaySeedV1;
    if (replaySeed && !replaySeed.appliedToLocalId) return false;
    const agentId = resolveAgentIdFromSessionMetadata(params.session.metadata);
    return agentId !== null
        && agentSupportsNativeTerminalSessions(agentId)
        && machineRecordStartsNativeTerminalSessions(params.machine);
}

/**
 * Opens a session as a terminal: its CLI resumes the conversation the session has (whatever chat
 * backend it ran on before), or starts one when it never had any.
 */
export function buildTerminalReopenOptions(params: Readonly<{
    sessionId: string;
    session: Session;
    machineId: string;
    directory: string;
    serverId: string | null;
}>): ResumeSessionOptions | null {
    const agentId = resolveAgentIdFromSessionMetadata(params.session.metadata);
    if (!agentId || !agentSupportsNativeTerminalSessions(agentId)) return null;
    const resume = resolveVendorResumeIdFromSessionMetadata(agentId, params.session.metadata);
    return {
        sessionId: params.sessionId,
        machineId: params.machineId,
        directory: params.directory,
        backendTarget: { kind: 'builtInAgent', agentId: getAgentCore(agentId).cli.spawnAgent },
        ...(resume ? { resume } : {}),
        ...(params.serverId ? { serverId: params.serverId } : {}),
        nativeTerminal: true,
    };
}
