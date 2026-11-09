import type { AgentId } from '@piggercode/agents';

import type { DaemonSpawnHooks, DaemonTerminalPresentation } from '@/daemon/spawnHooks';
import type { TerminalSpawnOptions } from '@/terminal/runtime/terminalConfig';

export type NativeTerminalSpawnDecision =
  | Readonly<{ ok: true; presentation: DaemonTerminalPresentation | null }>
  | Readonly<{ ok: false; errorMessage: string }>;

/**
 * Whether a spawn starts a 「终端」 session: the provider's own terminal app in a tmux window, with
 * nothing PiggerCode adds. The provider's spawn hooks own the presentation; a provider without one
 * has no terminal sessions, and the request is refused rather than started as a chat session.
 */
export function resolveNativeTerminalSpawn(params: Readonly<{
  requested: boolean;
  agentId: AgentId;
  hooks: DaemonSpawnHooks | null | undefined;
}>): NativeTerminalSpawnDecision {
  if (!params.requested) return { ok: true, presentation: null };
  const presentation = params.hooks?.nativeTerminalPresentation ?? null;
  if (!presentation) {
    return { ok: false, errorMessage: `${params.agentId} has no terminal sessions.` };
  }
  return { ok: true, presentation };
}

/** A terminal session needs a terminal to live in: it always runs in tmux, with the request's tmux options. */
export function resolveNativeTerminalHostRequest(terminal: TerminalSpawnOptions | undefined): TerminalSpawnOptions {
  return terminal?.mode === 'tmux' ? terminal : { mode: 'tmux' };
}
