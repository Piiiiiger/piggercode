import type { ActionId } from '@piggercode/protocol';

import type { ExecutionRunActionPermissionMode } from './executionRunActionPermissionMode';

export function resolveExecutionRunActionDefaultPermissionMode(actionId: ActionId): ExecutionRunActionPermissionMode | null {
    if (actionId === 'review.start' || actionId === 'subagents.plan.start') {
        return 'read_only';
    }
    if (actionId === 'subagents.delegate.start') {
        return 'workspace_write';
    }
    return null;
}
