import { banner, dim, helpFormatter, sectionTitle } from '@piggercode/cli-common/output';

import { listRootHelpCommands } from './commandSurfaceManifest';

const HELP_LABEL_WIDTH = 27;

const EXAMPLES = [
  { label: 'piggercode', description: 'Start session' },
  { label: 'piggercode session create --help', description: 'Create a scripted session with a model, title, and prompt' },
  { label: 'piggercode --refresh-settings', description: 'Force-refresh account settings before starting' },
  { label: 'piggercode --launch-profile <id-or-name>', description: 'Start with a launch profile from your settings' },
  { label: 'piggercode --auth cs:<id>', description: 'Start with an exact Connected Services profile or pool' },
  { label: 'piggercode --auth native', description: 'Start with native provider authentication' },
  { label: 'piggercode --auto', description: 'Automatically approve reads and edits', detail: 'Alias for --permission-mode auto; other tools may still require approval. Use --yolo for full access.' },
  { label: 'piggercode --yolo', description: 'Start with bypassing permissions', detail: 'piggercode sugar for --dangerously-skip-permissions' },
  { label: 'piggercode --chrome', description: 'Enable Chrome browser access for this session' },
  { label: 'piggercode --no-chrome', description: 'Disable Chrome even if default is on' },
  { label: 'piggercode --js-runtime bun', description: 'Use bun instead of node to spawn JavaScript-backed CLIs' },
  { label: 'piggercode auth login --force', description: 'Authenticate' },
  { label: 'piggercode profiles list', description: 'List available backend profiles' },
  { label: 'piggercode doctor', description: 'Run diagnostics' },
] as const;

export function buildRootHelpText(): string {
  const helpEntries = listRootHelpCommands();
  const usage = helpFormatter.renderRows(
    helpEntries.map((entry) => ({
      label: entry.rootHelpLabel ?? '',
      description: entry.rootHelpDescription ?? '',
      ...(entry.rootHelpDetail ? { detail: entry.rootHelpDetail } : {}),
    })),
    { labelWidth: HELP_LABEL_WIDTH },
  );
  const examples = helpFormatter.renderRows(EXAMPLES, { labelWidth: HELP_LABEL_WIDTH });
  return `
${banner('PiggerCode', { subtitle: 'Run, watch and steer your coding agents from any device.' })}

${sectionTitle('Usage')}
${usage}

${sectionTitle('Examples')}
${examples}

${sectionTitle('Server selection')} ${dim('(global flags; prefix-only; no persistence)')}
  piggercode --server <name-or-id> ...
  piggercode --server-url <url> [--webapp-url <url>] [--public-server-url <url>] ...
`;
}
