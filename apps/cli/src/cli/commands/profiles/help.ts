import chalk from 'chalk';

export function showProfilesHelp(): void {
  console.log(`
${chalk.bold('piggercode profiles')} - Backend profiles

${chalk.bold('Usage:')}
  piggercode profiles list [--refresh-settings] [--json]

${chalk.bold('Aliases:')}
  piggercode profile list

${chalk.bold('Notes:')}
  - Use --profile <id-or-name> when starting a session to apply a profile.
  - Run "piggercode auth login" to see custom profiles saved in your account settings.
`);
}

