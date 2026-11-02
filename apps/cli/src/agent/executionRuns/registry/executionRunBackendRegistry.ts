import { executionRunBackendFactory as claude, resolveIsolation as claudeResolveIsolation } from '@/backends/claude/executionRuns/executionRunBackendFactory';
import { executionRunBackendFactory as codex } from '@/backends/codex/executionRuns/executionRunBackendFactory';

import type { BackendIsolationBundle, BackendIsolationRequest } from '@/runtime/isolation/types';
import type { ExecutionRunBackendFactory } from './executionRunBackendTypes';

export type ExecutionRunBackendDescriptor = Readonly<{
  factory: ExecutionRunBackendFactory;
  resolveIsolation?: (request: BackendIsolationRequest, baseBundle: BackendIsolationBundle) => BackendIsolationBundle;
}>;

const REGISTRY: Record<string, ExecutionRunBackendDescriptor> = {
  claude: { factory: claude, resolveIsolation: claudeResolveIsolation },
  codex: { factory: codex },
};

// Aliases: UI/agents may reference provider IDs that are distinct from the execution-run backend ID.
REGISTRY['claude-code'] = REGISTRY.claude;

export function resolveExecutionRunBackendDescriptor(backendId: string): ExecutionRunBackendDescriptor | null {
  const key = String(backendId ?? '').trim();
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(REGISTRY, key) ? REGISTRY[key]! : null;
}

export function resolveExecutionRunBackendFactory(backendId: string): ExecutionRunBackendFactory | null {
  return resolveExecutionRunBackendDescriptor(backendId)?.factory ?? null;
}

// Preferred name: matches plan terminology and makes call sites self-describing.
export function getExecutionRunBackendFactory(backendId: string): ExecutionRunBackendFactory | null {
  return resolveExecutionRunBackendFactory(backendId);
}

export function getExecutionRunBackendDescriptor(backendId: string): ExecutionRunBackendDescriptor | null {
  return resolveExecutionRunBackendDescriptor(backendId);
}
