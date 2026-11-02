import { join } from 'node:path';

import { resolveHomeDirFromEnvironment } from '@piggercode/cli-common/providers';

import { resolveClaudeConfigDirOverride } from './resolveClaudeConfigDirOverride';

export function resolveConfiguredClaudeConfigDir(params: Readonly<{ env: NodeJS.ProcessEnv }>): string {
  const configuredOverride = resolveClaudeConfigDirOverride(params.env);
  return configuredOverride || join(resolveHomeDirFromEnvironment(params.env), '.claude');
}
