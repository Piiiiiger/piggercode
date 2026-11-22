import { AGENTS_CORE } from '@piggercode/agents';

import { agyDaemonSpawnHooks } from '@/backends/agy/daemon/spawnHooks';
import type { AgentCatalogEntry } from '../types';

/**
 * Google's Antigravity CLI (`agy`). Its sessions are 「终端」 sessions only: `agy` itself in tmux, with
 * its own sign-in, models and permissions (`nativeTerminal/agyNativeTerminal.ts`).
 */
export const agent = {
  id: AGENTS_CORE.agy.id,
  cliSubcommand: AGENTS_CORE.agy.cliSubcommand,
  getCliCommandHandler: async () => (await import('@/backends/agy/cli/command')).handleAgyCliCommand,
  getCliDetect: async () => (await import('@/backends/agy/cli/detect')).cliDetect,
  getCliAuthSpec: async () => (await import('@/backends/agy/cli/auth/agyCliAuthSpec')).agyCliAuthSpec,
  getDaemonSpawnHooks: async () => agyDaemonSpawnHooks,
  vendorResumeSupport: AGENTS_CORE.agy.resume.vendorResume,
} satisfies AgentCatalogEntry;
