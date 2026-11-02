export type CliCommandSurfaceEntry = Readonly<{
  command: string | null;
  rootHelpLabel?: string;
  rootHelpDescription?: string;
  rootHelpDetail?: string;
  allowTmux: boolean;
}>;

export const RESUME_COMMAND_USAGE = 'piggercode resume [<session-id-or-prefix>]';

const COMMAND_SURFACE_MANIFEST: readonly CliCommandSurfaceEntry[] = [
  {
    command: null,
    rootHelpLabel: 'piggercode [options]',
    rootHelpDescription: 'Start the default backend with mobile control',
    allowTmux: true,
  },
  {
    command: 'setup',
    rootHelpLabel: 'piggercode setup',
    rootHelpDescription: 'Connect this computer to your PiggerCode account',
    rootHelpDetail: 'choose where your relay lives, then sign in',
    allowTmux: false,
  },
  {
    command: 'auth',
    rootHelpLabel: 'piggercode auth',
    rootHelpDescription: 'Manage authentication',
    allowTmux: false,
  },
  {
    command: 'automation',
    rootHelpLabel: 'piggercode automation',
    rootHelpDescription: 'Trigger and manage automations',
    allowTmux: false,
  },
  {
    command: 'mcp',
    rootHelpLabel: 'piggercode mcp',
    rootHelpDescription: 'Expose the MCP server and manage MCP clients',
    allowTmux: false,
  },
  {
    command: 'codex',
    rootHelpLabel: 'piggercode codex',
    rootHelpDescription: 'Start Codex mode',
    allowTmux: true,
  },
  {
    command: 'connect',
    rootHelpLabel: 'piggercode connect',
    rootHelpDescription: 'Connect AI vendor API keys',
    allowTmux: false,
  },
  {
    command: 'notify',
    rootHelpLabel: 'piggercode notify',
    rootHelpDescription: 'Send push notification',
    allowTmux: false,
  },
  {
    command: 'install',
    rootHelpLabel: 'piggercode install',
    rootHelpDescription: 'Install provider CLIs and helpers',
    allowTmux: false,
  },
  {
    command: 'status',
    rootHelpLabel: 'piggercode status',
    rootHelpDescription: 'Show system status and recommended repairs',
    allowTmux: false,
  },
  {
    command: 'service',
    rootHelpLabel: 'piggercode service',
    rootHelpDescription: 'Manage automatic startup',
    rootHelpDetail: 'background services on this computer',
    allowTmux: false,
  },
  {
    command: 'daemon',
    rootHelpLabel: 'piggercode daemon',
    rootHelpDescription: 'Manage the local daemon process',
    rootHelpDetail: 'started manually or via automatic startup',
    allowTmux: false,
  },
  {
    command: 'doctor',
    rootHelpLabel: 'piggercode doctor',
    rootHelpDescription: 'System diagnostics & troubleshooting',
    allowTmux: false,
  },
  {
    command: 'herdr',
    rootHelpLabel: 'piggercode herdr',
    rootHelpDescription: 'Open Herdr for local terminal sessions',
    allowTmux: false,
  },
  {
    command: 'uninstall',
    allowTmux: false,
  },
  {
    command: 'logout',
    allowTmux: false,
  },
  {
    command: 'attach',
    rootHelpLabel: 'piggercode attach <session-id>',
    rootHelpDescription: 'Attach a terminal to a running session',
    allowTmux: false,
  },
  {
    command: 'self',
    allowTmux: false,
  },
  {
    command: 'server',
    allowTmux: false,
  },
  {
    command: 'session',
    allowTmux: false,
    rootHelpLabel: 'piggercode session',
    rootHelpDescription: 'Manage sessions and execution runs',
    rootHelpDetail: 'create scripted sessions with piggercode session create --help',
  },
  {
    command: 'resume',
    allowTmux: true,
    rootHelpLabel: RESUME_COMMAND_USAGE,
    rootHelpDescription: 'Resume an inactive session',
  },
  {
    // Compatibility alias: intentionally accepted but omitted from root help.
    command: 'sessions',
    allowTmux: false,
  },
  {
    // Compatibility alias: intentionally accepted but omitted from root help.
    command: 'automations',
    allowTmux: false,
  },
];

export function listRootHelpCommands(): readonly CliCommandSurfaceEntry[] {
  return COMMAND_SURFACE_MANIFEST.filter((entry) => typeof entry.rootHelpLabel === 'string');
}

export function isTmuxAllowedCommand(command: string | null | undefined): boolean {
  if (!command) return true;
  const entry = COMMAND_SURFACE_MANIFEST.find((candidate) => candidate.command === command);
  return entry ? entry.allowTmux : true;
}
