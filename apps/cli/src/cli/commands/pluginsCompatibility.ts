import chalk from 'chalk';

import type { CommandContext } from '@/cli/commandRegistry';
import { printJsonEnvelope, wantsJson } from '@/cli/output/jsonEnvelope';
import { fail } from '@piggercode/cli-common/output';

function usage(): string {
  return [
    `${chalk.bold('piggercode plugins')} - Plugin compatibility commands`,
    '',
    `${chalk.bold('Usage:')}`,
    '  piggercode plugins list [--json]',
    '',
    'This PiggerCode version does not support installing plugins.',
  ].join('\n');
}

export async function handlePluginsCompatibilityCliCommand(context: CommandContext): Promise<void> {
  const args = context.args.slice(1);
  const subcommand = args.find((arg) => !arg.startsWith('-')) ?? 'help';
  const json = wantsJson(args);

  if (subcommand === 'list') {
    if (json) {
      await printJsonEnvelope({ ok: true, kind: 'plugins_list', data: { plugins: [] } });
    } else {
      console.log('No plugins installed.');
    }
    return;
  }

  if (subcommand === 'help') {
    console.log(usage());
    return;
  }

  if (json) {
    await printJsonEnvelope({
      ok: false,
      kind: 'plugins_unsupported',
      error: {
        code: 'unsupported_in_this_version',
        message: `Plugin command '${subcommand}' is not supported by this PiggerCode version`,
      },
    });
    return;
  }

  console.error(fail(`Plugin command '${subcommand}' is not supported by this PiggerCode version`));
  console.log(usage());
  process.exitCode = 1;
}
