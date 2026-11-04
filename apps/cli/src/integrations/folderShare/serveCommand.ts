import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { configuration } from '@/configuration';
import { buildPosixShellCommand, buildPosixShellEnvironmentAssignments } from '@/utils/posixShellCommand';
import { buildHappyCliSubprocessLaunchSpec } from '@/utils/spawnHappyCLI';

/**
 * The forced command of a computer's key on this server: `piggercode machine shared-folders serve
 * --label <label>`. A managed install runs it through its `bin/piggercode` link, which follows updates,
 * so the authorized_keys line keeps working when this CLI's versioned path is replaced; any other run
 * (a source checkout) uses the launch this CLI would use for itself.
 */
export function buildSharedFoldersServeCommand(label: string): string {
  const args = ['machine', 'shared-folders', 'serve', '--label', label];
  const managedLink = join(configuration.happyHomeDir, 'bin', 'piggercode');
  if (isSameFile(managedLink, process.execPath)) return buildPosixShellCommand([managedLink, ...args]);

  const launch = buildHappyCliSubprocessLaunchSpec(args);
  const command = buildPosixShellCommand([launch.filePath, ...launch.args]);
  const env = launch.env ?? {};
  return Object.keys(env).length === 0 ? command : `${buildPosixShellEnvironmentAssignments(env)} ${command}`;
}

function isSameFile(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}
