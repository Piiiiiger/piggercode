import { runBackendSessionCliCommand } from '@/cli/runBackendSessionCliCommand';

import type { CommandContext } from '@/cli/commandRegistry';

/** `piggercode agy`: Antigravity as a 「终端」 session, the only kind it has. */
export async function handleAgyCliCommand(context: CommandContext): Promise<void> {
  await runBackendSessionCliCommand({
    context,
    loadNativeTerminal: async () => (await import('@/backends/agy/nativeTerminal/agyNativeTerminal')).agyNativeTerminal,
    agentIdForAccountSettings: 'agy',
    versionFlags: ['--version'],
  });
}
