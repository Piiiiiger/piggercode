import type { BackendTargetRefV1 } from '@piggercode/protocol';
import { normalizeClaudeHappyCliSessionControlPermissionMode } from '@/backends/claude/utils/permissionMode';
import { readNonBlankSessionControlIdentifier } from '@/agent/runtime/sessionControlIdentifiers';

function normalizeDaemonSessionPermissionModeForBackend(opts: {
  backendTarget?: BackendTargetRefV1;
  permissionMode: string;
}): string {
  if (opts.backendTarget?.kind === 'builtInAgent' && opts.backendTarget.agentId === 'claude') {
    return normalizeClaudeHappyCliSessionControlPermissionMode(opts.permissionMode);
  }
  return opts.permissionMode;
}

export function buildHappySessionControlArgs(opts: Readonly<{
  permissionMode?: string;
  permissionModeUpdatedAt?: number;
  agentModeId?: string;
  agentModeUpdatedAt?: number;
  modelId?: string;
  modelUpdatedAt?: number;
  resume?: string;
  existingSessionId?: string;
  backendTarget?: BackendTargetRefV1;
  /** A 「终端」 session: the runner starts the provider's own terminal app and adds nothing to it. */
  nativeTerminal?: boolean;
}>): string[] {
  const args: string[] = [];

  const resume = typeof opts.resume === 'string' ? opts.resume.trim() : '';
  if (resume) {
    args.push('--resume', resume);
  }

  const existingSessionId = typeof opts.existingSessionId === 'string' ? opts.existingSessionId.trim() : '';
  if (existingSessionId) {
    args.push('--existing-session', existingSessionId);
  }

  if (opts.nativeTerminal === true) {
    args.push('--native-terminal');
  }

  const permissionMode = typeof opts.permissionMode === 'string' ? opts.permissionMode.trim() : '';
  if (permissionMode) {
    args.push('--permission-mode', normalizeDaemonSessionPermissionModeForBackend({
      backendTarget: opts.backendTarget,
      permissionMode,
    }));
    if (typeof opts.permissionModeUpdatedAt === 'number') {
      args.push('--permission-mode-updated-at', `${opts.permissionModeUpdatedAt}`);
    }
  }

  const agentModeId = readNonBlankSessionControlIdentifier(opts.agentModeId) ?? '';
  if (agentModeId) {
    args.push('--agent-mode', agentModeId);
    if (typeof opts.agentModeUpdatedAt === 'number') {
      args.push('--agent-mode-updated-at', `${opts.agentModeUpdatedAt}`);
    }
  }

  const modelId = readNonBlankSessionControlIdentifier(opts.modelId) ?? '';
  if (modelId && typeof opts.modelUpdatedAt === 'number') {
    args.push('--model', modelId, '--model-updated-at', `${opts.modelUpdatedAt}`);
  }

  return args;
}
