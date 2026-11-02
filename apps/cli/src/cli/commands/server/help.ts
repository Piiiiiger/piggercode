import chalk from 'chalk';

import { configuration } from '@/configuration';

export function showServerHelp(): void {
  console.log(`
${chalk.bold('piggercode server')} - Manage relay profiles

${chalk.bold('Usage:')}
  piggercode server list
  piggercode server current
  piggercode server add [--name <name>] [--server-url <url>] [--public-server-url <url>] [--webapp-url <url>] [--use] [--no-use] [--yes] [--start-daemon] [--install-service]
  piggercode server use <name-or-id>
  piggercode server remove <name-or-id> [--force]
  piggercode server test [<name-or-id>]
  piggercode server set [--server-id <id>] --server-url <url> [--public-server-url <url>] [--webapp-url <url>]

${chalk.bold('Notes:')}
  • Profiles are stored in ${configuration.settingsFile}
  • Credentials are stored per relay profile under ${configuration.serversDir}
  • Public relay URL is used for QR codes/deep links (defaults to relay URL)
  • add checks the relay answers /v1/version before saving it; --yes saves it without checking
  • Env vars override for one run: PIGGERCODE_SERVER_URL / PIGGERCODE_PUBLIC_SERVER_URL / PIGGERCODE_WEBAPP_URL
`);
}
