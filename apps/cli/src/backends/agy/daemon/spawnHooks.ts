import type { DaemonSpawnHooks } from '@/daemon/spawnHooks';
import { validateProviderCliSpawn } from '@/runtime/managedTools/validateProviderCliSpawn';

export const agyDaemonSpawnHooks: DaemonSpawnHooks = {
  nativeTerminalPresentation: { kind: 'runner', startingMode: 'local' },
  // The runner launches agy itself; refuse before any session exists when it is missing.
  validateSpawn: async (runtimeSelection) =>
    await validateProviderCliSpawn({ agentId: 'agy', processEnv: runtimeSelection.environmentVariables ?? process.env }),
};
