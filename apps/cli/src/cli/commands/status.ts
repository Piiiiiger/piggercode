import type { CommandContext } from '@/cli/commandRegistry';
import { handleServiceRepairCliCommand } from './serviceRepair/handleServiceRepairCliCommand';

export async function handleStatusCliCommand(context: CommandContext): Promise<void> {
  if (context.args.includes('--yes')) {
    throw new Error('piggercode status is read-only. Use `piggercode doctor repair --yes` to apply repairs.');
  }

  await handleServiceRepairCliCommand({
    argv: ['repair', '--report-only', ...context.args.slice(1)],
    commandPath: 'piggercode status',
  });
}
