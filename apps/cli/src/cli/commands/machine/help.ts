import chalk from 'chalk';

export function showMachineHelp(): void {
  console.log(`
${chalk.bold('piggercode machine')} - Bootstrap and manage remote machines

${chalk.bold('Usage:')}
  piggercode machine setup --ssh <user@host> [--identity-file <path>] [--ssh-config-file <path>] [--known-hosts-path <path>] [--trusted-host-key <line>]
  piggercode machine setup --ssh <user@host> [--server <name-or-id> | --server-url <url> [--webapp-url <url>] [--public-server-url <url>]]
  piggercode machine setup --ssh <user@host> [--service-mode <user|none>] [--install-relay-runtime] [--relay-runtime-mode <user|system>] [--yes] [--json]
  piggercode machine remote-commands on|off|status [--json]
  piggercode machine shared-folders address [<host[:port]> | --clear] [--json]
  piggercode machine shared-folders status [--json]

${chalk.bold('Notes:')}
  • This is a thin wrapper over the canonical remote SSH bootstrap task.
  • Use --json to stream protocol event/result JSON lines.
  • In interactive terminals, SSH host trust and pairing approval prompts are surfaced inline.
  • Use --yes to auto-accept setup prompts in non-interactive runs.
  • remote-commands on lets agents on your other machines run shell commands on this machine
    (the machine.command.run tool). It is off until you turn it on here or with the Remote commands
    switch on this machine's page in the app.
  • shared-folders address, on a server, sets the SSH address your other machines reach it at
    (host or host:port). Once it is set, a computer can share folders with this machine from
    its page in the app; each appears here where it is placed (~/<folder name> by default, beside your
    other folders). Needs sshfs on this machine.
  `);
}
