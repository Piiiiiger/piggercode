import { resolveAgentIdFromSessionMetadata, resolveVendorResumeIdFromSessionMetadata } from '@piggercode/agents';

import { agentSupportsNativeTerminalSessions, getAgentCore } from '@/agents/registry/registryCore';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { ResumeSessionOptions } from '@/sync/ops';

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
    };
}
