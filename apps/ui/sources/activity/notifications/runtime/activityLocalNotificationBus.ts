import type { Message } from '@/sync/domains/messages/messageTypes';
import type { TerminalWaiting } from '@/sync/domains/state/storageTypes';
import type { AgentRequestKind } from '@/utils/sessions/permissions/permissionPromptPolicy';

export type ActivityLocalNotificationEvent =
    | Readonly<{
        kind: 'ready';
        sessionId: string;
        messages?: Message[];
    }>
    | Readonly<{
        kind: 'agent-request';
        sessionId: string;
        requestId: string;
        requestKind: AgentRequestKind;
        toolName: string;
        toolArgs: unknown;
    }>
    | Readonly<{
        /** A 「终端」 session's terminal waits for the user: a prompt, or a CLI that quit with an error. */
        kind: 'terminal-wait';
        sessionId: string;
        waiting: TerminalWaiting;
    }>;

type Listener = (event: ActivityLocalNotificationEvent) => void;

const listeners = new Set<Listener>();

export function subscribeActivityLocalNotifications(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function publish(event: ActivityLocalNotificationEvent): void {
    for (const listener of Array.from(listeners)) {
        try {
            listener(event);
        } catch {
            // ignore listener failures
        }
    }
}

export function notifyActivityReady(sessionId: string, messages?: Message[]): void {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) return;
    publish({ kind: 'ready', sessionId: normalizedSessionId, messages });
}

export function notifyActivityTerminalWait(sessionId: string, waiting: TerminalWaiting): void {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) return;
    publish({ kind: 'terminal-wait', sessionId: normalizedSessionId, waiting });
}

export function notifyActivityAgentRequest(params: Readonly<{
    sessionId: string;
    requestId: string;
    requestKind: AgentRequestKind;
    toolName: string;
    toolArgs: unknown;
}>): void {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
    const requestId = typeof params.requestId === 'string' ? params.requestId.trim() : '';
    const toolName = typeof params.toolName === 'string' ? params.toolName.trim() : '';
    if (!sessionId || !requestId || !toolName) return;

    publish({
        kind: 'agent-request',
        sessionId,
        requestId,
        requestKind: params.requestKind,
        toolName,
        toolArgs: params.toolArgs,
    });
}

export function resetActivityLocalNotificationRuntimeForTests(): void {
    listeners.clear();
}
