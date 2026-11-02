import { BackendTargetRefSchema, parseBackendTargetKey, type BackendTargetRefV1 } from '@piggercode/protocol';

function parseSerializedBackendTarget(value: unknown): BackendTargetRefV1 | null {
    const parsed = BackendTargetRefSchema.safeParse(value);
    if (parsed.success) {
        return parsed.data;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsedJson = JSON.parse(trimmed);
        const parsedTarget = BackendTargetRefSchema.safeParse(parsedJson);
        return parsedTarget.success ? parsedTarget.data : null;
    } catch {
        return null;
    }
}

export function resolveBackendTargetFromRouteParams(params: Readonly<{
    backendTarget?: unknown;
    backendTargetKey?: unknown;
    agentType?: unknown;
}>): BackendTargetRefV1 | null {
    const parsedTarget = parseSerializedBackendTarget(params.backendTarget);
    if (parsedTarget) {
        return parsedTarget;
    }

    if (typeof params.backendTargetKey === 'string') {
        const trimmedKey = params.backendTargetKey.trim();
        if (trimmedKey) {
            try {
                return parseBackendTargetKey(trimmedKey);
            } catch {
                return null;
            }
        }
    }

    if (typeof params.agentType !== 'string') {
        return null;
    }

    const normalizedAgentType = params.agentType.trim();
    if (!normalizedAgentType) {
        return null;
    }

    return { kind: 'builtInAgent', agentId: normalizedAgentType };
}
