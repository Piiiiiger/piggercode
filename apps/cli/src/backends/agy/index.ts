import { AGENTS_CORE } from '@piggercode/agents';

import { agyDaemonSpawnHooks } from '@/backends/agy/daemon/spawnHooks';
import type { AgentCatalogEntry } from '../types';

/**
 * Google's Antigravity CLI (`agy`). Its sessions are 「终端」 sessions only: `agy` itself in tmux, with
 * its own sign-in and permissions (`nativeTerminal/agyNativeTerminal.ts`) and dynamic model probing via `agy models`.
 */
export const agent = {
  id: AGENTS_CORE.agy.id,
  cliSubcommand: AGENTS_CORE.agy.cliSubcommand,
  getCliCommandHandler: async () => (await import('@/backends/agy/cli/command')).handleAgyCliCommand,
  getCliDetect: async () => (await import('@/backends/agy/cli/detect')).cliDetect,
  getCliAuthSpec: async () => (await import('@/backends/agy/cli/auth/agyCliAuthSpec')).agyCliAuthSpec,
  getDaemonSpawnHooks: async () => agyDaemonSpawnHooks,
  getPreflightSessionControlsProbeAdapter: async () =>
    (await import('@/backends/agy/preflight/agyPreflightSessionControlsProbeAdapter')).agyPreflightSessionControlsProbeAdapter,
  vendorResumeSupport: AGENTS_CORE.agy.resume.vendorResume,
} satisfies AgentCatalogEntry;
